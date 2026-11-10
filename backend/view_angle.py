"""
切换视角（View Angle）

画布选中一张图后「切换视角」的后端能力：把用户在机位控件上选的方位、俯仰、景别
换算成生图模型能稳定理解的方位描述，拼成内置 prompt，以原图为唯一参考图生图。

生图模型不能精确执行「转 37°」这类数字，只能稳定理解「右侧」「右后方」「背面」这类方向，
所以方位按 45° 吸附为 8 档、俯仰吸附为 3 档，前端控件使用同一套档位。
"""
from __future__ import annotations

import io

# 方位角：相机从原机位出发向画面右侧绕主体转动的角度（与前端机位控件一致），label 是机位名
AZIMUTHS: dict[int, dict[str, str]] = {
    0: {"label": "正面"},
    45: {"label": "右前方"},
    90: {"label": "右侧"},
    135: {"label": "右后方"},
    180: {"label": "背面"},
    225: {"label": "左后方"},
    270: {"label": "左侧"},
    315: {"label": "左前方"},
}

# 主体在画面中的朝向，用「正面朝镜头时相机需要转到的方位」编码，与 AZIMUTHS 同一套角度。
# 最终朝向 = 原图朝向 + 用户选的机位转角。实测只写「相机绕到画面右侧」时人物常被画成反方向，
# 所以提示词直接用画面方向写出最终朝向，并明确否定反方向。
FACINGS: dict[int, str] = {
    0: "正面：主体的脸和身体正面朝向镜头",
    45: "3/4 侧面：主体的脸和身体正面斜朝画面左侧，能看到主体正面和它自身左侧的一部分。注意是朝画面左侧，不要朝画面右侧",
    90: "正侧面：主体的脸和身体正面朝向画面左侧（看向画面的左边缘），镜头看到的是主体自身的左侧。注意是朝画面左侧，不要朝画面右侧",
    135: "3/4 背面：主体大部分背对镜头，脸和身体正面朝向画面左后方，能看到背面和主体自身的左侧。注意是朝画面左后方，不要朝画面右后方",
    180: "背面：主体完全背对镜头，看到原图中看不到的背面",
    225: "3/4 背面：主体大部分背对镜头，脸和身体正面朝向画面右后方，能看到背面和主体自身的右侧。注意是朝画面右后方，不要朝画面左后方",
    270: "正侧面：主体的脸和身体正面朝向画面右侧（看向画面的右边缘），镜头看到的是主体自身的右侧。注意是朝画面右侧，不要朝画面左侧",
    315: "3/4 侧面：主体的脸和身体正面斜朝画面右侧，能看到主体正面和它自身右侧的一部分。注意是朝画面右侧，不要朝画面左侧",
}

# 视觉模型判断原图朝向时的选项，字母对应 FACINGS 的角度
FACING_QUESTION = """判断图中主要主体（人物看身体躯干，不看头和视线；物体看它的正面）朝向画面的哪个方向，只回答一个字母：
A 正对镜头
B 身体斜着朝向画面左侧（3/4 侧面，能看到大部分正面）
C 正侧面，朝向画面左侧
D 大部分背对镜头，朝向画面左后方
E 背对镜头
F 大部分背对镜头，朝向画面右后方
G 正侧面，朝向画面右侧
H 身体斜着朝向画面右侧（3/4 侧面，能看到大部分正面）"""
FACING_CODES = {"A": 0, "B": 45, "C": 90, "D": 135, "E": 180, "F": 225, "G": 270, "H": 315}

# 俯仰：相机高度相对原机位的变化
# 鸟瞰、贴地仰拍是极限机位，提示词沿用实测通过的写法
ELEVATIONS: dict[int, dict[str, str]] = {
    -60: {"label": "贴地仰拍", "desc": "相机贴近地面，在主体脚边以约 60° 的大角度向上仰拍，主体显得高大。背景换成这个低机位抬头能看到的部分："
                                    "户外通常是天空或树冠，室内是天花板；图1是纯色或棚拍背景时，保持同样的纯色背景，不要换成天空"},
    -20: {"label": "仰视", "desc": "相机降低，约 20° 自下而上仰视主体"},
    0: {"label": "平视", "desc": "相机高度与原图一致"},
    30: {"label": "俯视", "desc": "相机升高，约 30° 自上而下俯视主体"},
    90: {"label": "鸟瞰", "desc": "相机升到主体正上方，垂直向下俯拍（鸟瞰，约 90°）。画面里主要看到主体的头顶、肩膀和下方地面，"
                                 "人物呈现从正上方往下看时的透视压缩"},
}
EXTREME_ELEVATIONS = {-60, 90}

# 景别都以图1的取景为基准：只写「主体完整入镜」时，半身图会被拉远成全身
DISTANCES: dict[str, dict[str, str]] = {
    "closer": {"label": "近景", "desc": "相机比图1更靠近主体，取景比图1更紧（例如图1是全身则变为半身），主体在画面中更大"},
    "same": {"label": "原景别", "desc": "取景范围与图1保持一致：图1拍到主体的哪些部位，新图就只拍到这些部位，"
                                    "画面边缘裁切主体的位置（例如胸口、腰部、膝盖）与图1相同，主体在画面中的大小与图1相近。"
                                    "图1是半身或近景时，不要拉远成全身"},
    "farther": {"label": "远景", "desc": "相机比图1更远，取景比图1更宽（例如图1是半身则露出更多身体），主体在画面中更小，四周露出更多环境"},
    "extreme_close": {"label": "大特写", "desc": "相机推近到只拍主体最有特征的局部：人物只拍脸部和肩膀以上（大特写），脸部占画面的大部分"},
    "extreme_far": {"label": "极远景", "desc": "相机拉到很远处，主体只占画面高度的八分之一左右，四周是大面积的环境"},
    # 背后过肩只能从主体身后拍，normalize_views 会把方位固定为背面
    "over_shoulder": {"label": "背后过肩", "desc": "相机在主体身后、高于头顶，越过主体的肩膀向前下方俯视：能看到主体的后脑、肩膀和背部上方，"
                                             "以及主体前方的地面和环境；主体的头、肩和背部上方在画面前景中"},
}
# 鸟瞰、贴地仰拍时取景以完整拍到主体为准（实测写法），原图半身时也不沿用原取景
WHOLE_SUBJECT = "主体完整出现在画面中"
DUTCH_DESC = "相机绕镜头光轴倾斜约 25°（荷兰角）：整个画面连同地平线、背景和主体一起倾斜"

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


def view_label(azimuth: int, elevation: int, distance: str = "same", dutch: bool = False) -> str:
    """结果图上显示的视角名，如「背面 · 俯视」。"""
    if distance == "over_shoulder":
        bits = [DISTANCES[distance]["label"]]
    else:
        # 方位不变时只说俯仰和景别，避免「正面 · 俯视」这种多余的说法
        bits = [] if azimuth == 0 and (elevation or distance != "same" or dutch) else [AZIMUTHS[azimuth]["label"]]
        if elevation:
            bits.append(ELEVATIONS[elevation]["label"])
        if distance != "same":
            bits.append(DISTANCES[distance]["label"])
    if dutch:
        bits.append("倾斜")
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
        dutch = bool(item.get("dutch"))
        if elevation == 90:
            azimuth = 0  # 正上方俯拍没有水平方位
        if distance == "over_shoulder":
            azimuth = 180
            elevation = 30 if elevation in EXTREME_ELEVATIONS else elevation
        if azimuth == 0 and elevation == 0 and distance == "same" and not dutch:
            raise ValueError("请选择一个与原图不同的视角")
        view = {"azimuth": azimuth, "elevation": elevation, "distance": distance, "dutch": dutch}
        if view not in views:
            views.append(view)
    if not views:
        raise ValueError("请至少选择一个视角")
    if len(views) > MAX_VIEWS:
        raise ValueError(f"一次最多生成 {MAX_VIEWS} 个视角")
    return views


def parse_facing(answer: str) -> int | None:
    """视觉模型的回答 → 原图朝向角度；回答不在选项里时返回 None。"""
    letter = (answer or "").strip().lstrip("*「（(").upper()[:1]
    return FACING_CODES.get(letter)


async def detect_facing(image_bytes: bytes, *, timeout: float = 30) -> int | None:
    """用视觉模型判断原图主体朝向；服务不可用或回答无法识别时返回 None，调用方按正面处理。"""
    from .ai_image import compress_image_to_data_url
    from .model_routing import routed_chat_completion

    payload = {
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": FACING_QUESTION},
            {"type": "image_url", "image_url": {"url": compress_image_to_data_url(image_bytes, 768)}},
        ]}],
        # 推理模型的思考也计入 max_tokens，给太少会返回空内容
        "max_tokens": 600, "temperature": 0,
    }
    resp = await routed_chat_completion("vlm", payload, timeout=timeout)
    content = (((resp.json() or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    return parse_facing(str(content))


def build_view_prompt(*, azimuth: int, elevation: int, distance: str = "same", dutch: bool = False,
                      mode: str = "camera", extra_prompt: str = "", source_facing: int = 0) -> str:
    """拼装切换视角的内置 prompt。图1 为原图，也是唯一参考图。

    source_facing 是原图主体的朝向（FACINGS 的角度），最终朝向 = 原图朝向 + 机位转角。
    """
    lines = [
        "任务：多视角重绘。把图1中的同一个主体，换成从另一个机位观察到的样子，输出一张新的完整照片。",
        "",
        "新视角：",
    ]
    if mode == "subject":
        lines.append("- 相机位置和背景保持与图1一致，让主体在原地转动，使镜头看到以下角度：")
    if distance == "over_shoulder":
        lines.append(f"- 机位：{DISTANCES[distance]['desc']}。")
    else:
        if elevation == 90:
            pass  # 正上方俯拍没有水平方位
        elif azimuth == 0:
            lines.append("- 水平方位：保持图1中主体的朝向不变。")
        else:
            lines.append(f"- 水平方位：{FACINGS[(source_facing + azimuth) % 360]}。与图1相比，主体的朝向要明显改变。")
        lines.append(f"- 俯仰：{ELEVATIONS[elevation]['desc']}。")
        if distance == "same" and elevation in EXTREME_ELEVATIONS:
            lines.append(f"- 景别：{WHOLE_SUBJECT}。")
        else:
            lines.append(f"- 景别：{DISTANCES[distance]['desc']}。")
    if dutch:
        lines.append(f"- 镜头倾斜：{DUTCH_DESC}。")
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
        "- 不要添加图1中没有的物体、人物、文字或水印。",
    ]
    if extra_prompt.strip():
        lines += ["", f"补充要求：{extra_prompt.strip()[:300]}"]
    return "\n".join(lines)
