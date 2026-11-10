"""
切换视角（View Angle）

画布选中一张图后「切换视角」的后端能力：把用户在机位控件上选的方位、俯仰、景别
换算成生图模型能稳定理解的方位描述，拼成内置 prompt，以原图为唯一参考图生图。

生图模型不能精确执行「转 37°」这类数字，只能稳定理解「右侧」「右后方」「背面」这类方向，
所以方位按 45° 吸附为 8 档、俯仰吸附为 3 档，前端控件使用同一套档位。
"""
from __future__ import annotations

import io

# 方位角：相机从原机位出发向画面右侧绕主体转动的角度（与前端机位控件一致）。
# 实测只写「相机绕到画面右侧」时，人物常被画成朝相反方向，所以直接用画面方向写出结果，并明确否定反方向。
AZIMUTHS: dict[int, dict[str, str]] = {
    0: {"label": "正面", "desc": "保持原图的水平观察方向"},
    45: {"label": "右前方", "desc": "3/4 侧面：主体原地向画面左侧转身约 45°，脸和身体正面斜朝画面左侧，"
                                    "能看到主体正面和它自身左侧的一部分。注意是朝画面左侧，不要朝画面右侧"},
    90: {"label": "右侧", "desc": "正侧面：主体的脸和身体正面朝向画面左侧（看向画面的左边缘），"
                                  "镜头看到的是主体自身的左侧。注意是朝画面左侧，不要朝画面右侧"},
    135: {"label": "右后方", "desc": "3/4 背面：主体大部分背对镜头，脸和身体正面朝向画面左后方，"
                                     "能看到背面和主体自身的左侧。注意是朝画面左后方，不要朝画面右后方"},
    180: {"label": "背面", "desc": "背面：主体完全背对镜头，看到原图中看不到的背面"},
    225: {"label": "左后方", "desc": "3/4 背面：主体大部分背对镜头，脸和身体正面朝向画面右后方，"
                                     "能看到背面和主体自身的右侧。注意是朝画面右后方，不要朝画面左后方"},
    270: {"label": "左侧", "desc": "正侧面：主体的脸和身体正面朝向画面右侧（看向画面的右边缘），"
                                   "镜头看到的是主体自身的右侧。注意是朝画面右侧，不要朝画面左侧"},
    315: {"label": "左前方", "desc": "3/4 侧面：主体原地向画面右侧转身约 45°，脸和身体正面斜朝画面右侧，"
                                     "能看到主体正面和它自身右侧的一部分。注意是朝画面右侧，不要朝画面左侧"},
}

# 俯仰：相机高度相对原机位的变化
ELEVATIONS: dict[int, dict[str, str]] = {
    -20: {"label": "仰视", "desc": "相机降低，约 20° 自下而上仰视主体"},
    0: {"label": "平视", "desc": "相机高度与原图一致"},
    30: {"label": "俯视", "desc": "相机升高，约 30° 自上而下俯视主体"},
}

DISTANCES: dict[str, dict[str, str]] = {
    "closer": {"label": "近景", "desc": "相机比原图更靠近主体，主体在画面中更大，但主体仍完整入镜"},
    "same": {"label": "原景别", "desc": "主体在画面中的大小与原图相近"},
    "farther": {"label": "远景", "desc": "相机比原图更远，主体在画面中更小，四周露出更多环境"},
}

MODES = {"camera", "subject"}
MAX_VIEWS = 4


def flatten_alpha(image_bytes: bytes) -> bytes:
    """透明区域铺白底。换视角时透明通道没有意义，留着模型会随机画成白底或黑边。"""
    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as src:
        src.load()
        if not (src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)):
            return image_bytes
        rgba = src.convert("RGBA")
    flat = Image.new("RGB", rgba.size, (255, 255, 255))
    flat.paste(rgba, mask=rgba.getchannel("A"))
    out = io.BytesIO()
    flat.save(out, format="PNG")
    return out.getvalue()


def snap_azimuth(value: float) -> int:
    """任意角度吸附到最近的 45° 档位（0–315）。"""
    return int(round((float(value) % 360) / 45) * 45) % 360


def snap_elevation(value: float) -> int:
    return min(ELEVATIONS, key=lambda level: abs(level - float(value)))


def view_label(azimuth: int, elevation: int, distance: str = "same") -> str:
    """结果图上显示的视角名，如「背面 · 俯视」。"""
    # 方位不变时只说俯仰和景别，避免「正面 · 俯视」这种多余的说法
    bits = [] if azimuth == 0 and (elevation or distance != "same") else [AZIMUTHS[azimuth]["label"]]
    if elevation:
        bits.append(ELEVATIONS[elevation]["label"])
    if distance != "same":
        bits.append(DISTANCES[distance]["label"])
    return " · ".join(bits)


def normalize_views(raw_views: list) -> list[dict]:
    """校验并吸附前端传来的视角列表，去重后最多 MAX_VIEWS 个。"""
    views: list[dict] = []
    for item in raw_views:
        if not isinstance(item, dict):
            raise ValueError("views 格式错误")
        try:
            azimuth = snap_azimuth(item.get("azimuth", 0))
            elevation = snap_elevation(item.get("elevation", 0))
        except (TypeError, ValueError) as exc:
            raise ValueError("视角角度必须是数字") from exc
        distance = str(item.get("distance") or "same")
        if distance not in DISTANCES:
            raise ValueError(f"不支持的景别：{distance}")
        if azimuth == 0 and elevation == 0 and distance == "same":
            raise ValueError("请选择一个与原图不同的视角")
        view = {"azimuth": azimuth, "elevation": elevation, "distance": distance}
        if view not in views:
            views.append(view)
    if not views:
        raise ValueError("请至少选择一个视角")
    if len(views) > MAX_VIEWS:
        raise ValueError(f"一次最多生成 {MAX_VIEWS} 个视角")
    return views


def build_view_prompt(*, azimuth: int, elevation: int, distance: str = "same",
                      mode: str = "camera", extra_prompt: str = "") -> str:
    """拼装切换视角的内置 prompt。图1 为原图，也是唯一参考图。"""
    lines = [
        "任务：多视角重绘。把图1中的同一个主体，换成从另一个机位观察到的样子，输出一张新的完整照片。",
        "",
        "新视角：",
    ]
    if mode == "subject":
        lines.append("- 相机位置和背景保持与图1一致，让主体在原地转动，使镜头看到以下角度：")
    lines.append(f"- 水平方位：{AZIMUTHS[azimuth]['desc']}。")
    lines.append(f"- 俯仰：{ELEVATIONS[elevation]['desc']}。")
    lines.append(f"- 景别：{DISTANCES[distance]['desc']}。")
    lines += [
        "",
        "主体必须保持不变（最重要）：",
        "- 新图中的主体必须与图1是同一个主体，只是观察角度不同，不能换成另一个相似的物体或人。",
        "- 保持主体的整体造型、比例、结构、配色、材质、纹理、图案和印花完全一致，不新增、不删除、不改动任何设计元素。",
        "- 图1中可见的 logo、文字、标签在新角度下仍应出现在主体的同一位置，随透视自然变形；"
        "转到看不到的一侧时就不要画出来，不要凭空新增 logo 或文字。",
        "- 如果主体是人物，保持同一张脸、发型、体型和整套穿着搭配，只改变相机看人物的角度。"
        "上面说的「主体自身的左侧 / 右侧」指人物自己身体的左右，不是画面的左右。",
        "- 图1中看不到的部分（例如背面、另一侧）需要合理推测：延续可见部分的设计语言、配色和材质，"
        "保持对称和结构上的合理，不要发挥成新的设计。",
        "",
        "画面要求：",
    ]
    if mode == "subject":
        lines.append("- 背景、地面、光线保持与图1一致，只有主体朝向发生变化。")
    else:
        lines.append("- 背景随相机移动同步变化：保持同一个场景、同样的环境和光线氛围，展示该机位下应看到的那部分环境。")
    lines += [
        "- 光线方向、色调和摄影风格与图1保持一致，阴影随新角度合理变化。",
        "- 主体完整入镜，不要裁切；不要添加图1中没有的物体、人物、文字或水印。",
    ]
    if extra_prompt.strip():
        lines += ["", f"补充要求：{extra_prompt.strip()[:300]}"]
    return "\n".join(lines)
