"""
Pydantic 数据模型 — 请求/响应/内部状态
"""
from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


# ─── 模板相关 ─────────────────────────────────────────────────────────────────


class SlotInfo(BaseModel):
    id: str
    name: str  # slot/product_1/image 格式
    type: str  # "rect" | "text" | "frame"
    page_id: str
    x: float
    y: float
    width: float
    height: float


class TemplateInfo(BaseModel):
    """penpot 中一个 frame（画板）对应一个模板"""
    id: str  # frame 的 object id
    name: str
    page_name: str = ""    # 所在 page 的名称（直接读自 Penpot page.name）
    group_name: str = ""   # 分组名：优先用 page_name，兼容画板名含 "/" 的旧约定
    variant: str = ""      # 变体名（画板名，或 "/" 右边部分）
    page_id: str
    file_id: str
    x: float = 0       # frame 在画布上的绝对 x 坐标
    y: float = 0       # frame 在画布上的绝对 y 坐标
    width: float
    height: float
    slots: list[SlotInfo] = Field(default_factory=list)
    thumbnail_url: Optional[str] = None  # 前端展示用
    is_special: bool = False  # 来自"特殊品模板"文件，选中时自动激活 /特殊品 流程


class TemplateGroup(BaseModel):
    """多画板模板组（特殊品等需要同时导出多个画板的场景）"""
    group_name: str          # 组名，如 "特殊品"
    file_id: str
    frames: list[TemplateInfo] = Field(default_factory=list)  # 组内所有画板


# ─── 合成任务 ────────────────────────────────────────────────────────────────


class ProductSlot(BaseModel):
    """
    单个产品格子的内容。
    image_path 固定字段；其余文字字段由 slot_schema.json 定义，
    用 extra="allow" 动态接收，不在 schema 里的字段也不会报错。
    """
    model_config = {"extra": "allow"}

    image_path: Optional[str] = None   # 本地图片路径（image 类型 slot 专用）

    def get_text_fields(self) -> dict[str, Optional[str]]:
        """返回所有文字字段 key→value，包含 schema 里定义的和动态传入的额外字段"""
        excluded = {"image_path"}
        result: dict[str, Optional[str]] = {}
        # Pydantic v2: model_fields_set + __pydantic_extra__
        for k, v in self.__dict__.items():
            if k.startswith("_") or k in excluded:
                continue
            result[k] = v if isinstance(v, str) else None
        # 动态 extra 字段
        extras = self.__pydantic_extra__ or {}
        for k, v in extras.items():
            if k not in excluded:
                result[k] = str(v) if v is not None else None
        return result


class ComposeRequest(BaseModel):
    """触发合成的请求体"""
    file_id: str
    template_frame_id: str   # 选中的模板 frame id
    page_id: str
    slots: dict[str, ProductSlot] = Field(
        default_factory=dict,
        description="key 为 product_1 / product_2 等，value 为产品内容",
    )
    export_scale: float = 2.0


class ComposeStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


class ComposeJob(BaseModel):
    """合成任务状态"""
    id: str
    status: ComposeStatus = ComposeStatus.pending
    request: ComposeRequest
    result_path: Optional[str] = None
    penpot_file_id: Optional[str] = None
    penpot_edit_url: Optional[str] = None
    error: Optional[str] = None
    progress: list[str] = Field(default_factory=list)
    created_at: Optional[float] = None      # Unix 时间戳


# ─── 表格解析 ────────────────────────────────────────────────────────────────


class ParsedProduct(BaseModel):
    """
    解析出的单个产品。image_path 固定；文字字段动态，由 slot_schema.json 决定。
    """
    model_config = {"extra": "allow"}

    image_path: Optional[str] = None   # 匹配到的本地图片路径（可能为 None）


class ParseResult(BaseModel):
    """AI 解析表格的结果"""
    products: list[ParsedProduct]
    suggested_template_type: str  # "single" | "grid_4" | "grid_6" | "grid_9"
    raw_table: Optional[str] = None


# ─── 导出 ────────────────────────────────────────────────────────────────────


class ExportRequest(BaseModel):
    job_id: str


class GridExportRequest(BaseModel):
    job_id: str
    rows: int = 3
    cols: int = 3


# ─── 特殊品合成 ──────────────────────────────────────────────────────────────


class SpecialComposeRequest(BaseModel):
    """
    特殊品合成请求。
    file_id / page_id 指向 penpot 文件；
    frame_ids 为该组所有画板的 frame id（可能多个）；
    sku 用于图库匹配，fields 为文字字段 key→value。
    """
    file_id: str
    page_id: str
    frame_ids: list[str]          # 所有画板的 frame id
    sku: str                       # 图片匹配用
    fields: dict[str, str] = Field(default_factory=dict)  # name/time 等文字字段
    export_scale: float = 2.0


class SpecialComposeJob(BaseModel):
    """特殊品合成任务状态（可包含多个输出文件）"""
    id: str
    status: ComposeStatus = ComposeStatus.pending
    request: SpecialComposeRequest
    result_paths: list[str] = Field(default_factory=list)  # 每个画板对应一个输出（export_frame 兜底）
    result_frame_ids: list[str] = Field(default_factory=list)  # 副本中的 frame id（同原模板）
    penpot_file_id: Optional[str] = None   # 副本 file id，用于前端取缩略图
    penpot_page_id: Optional[str] = None   # 副本 page id
    penpot_edit_url: Optional[str] = None
    error: Optional[str] = None
    progress: list[str] = Field(default_factory=list)
    created_at: Optional[float] = None
