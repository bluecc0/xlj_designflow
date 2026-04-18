/**
 * 后端 API 客户端
 * 封装所有与 FastAPI 后端的通信
 */

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

export interface SlotInfo {
  id: string;
  name: string;
  type: string;
  page_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateInfo {
  id: string;
  name: string;
  page_id: string;
  file_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  slots: SlotInfo[];
  thumbnail_url?: string;
}

export interface ProductSlot {
  image_path?: string | null;
  name?: string | null;
  price?: string | null;
  tag?: string | null;
  spec?: string | null;
}

export interface ComposeRequest {
  file_id: string;
  template_frame_id: string;
  page_id: string;
  slots: Record<string, ProductSlot>;
  export_scale?: number;
}

export type ComposeStatus = "pending" | "running" | "done" | "failed";

export interface ComposeJob {
  id: string;
  status: ComposeStatus;
  request: ComposeRequest;
  result_path?: string;
  penpot_file_id?: string;
  penpot_edit_url?: string;
  error?: string;
  progress: string[];
  created_at?: number;  // Unix 时间戳（秒）
}

export interface ParsedProduct {
  name?: string;
  price?: string;
  tag?: string;
  spec?: string;
  image_path?: string;
}

export interface ParseResult {
  products: ParsedProduct[];
  suggested_template_type: string;
  raw_table?: string;
}

export interface ProductItem {
  name: string;
  filename: string;
  path: string;
  size: number;
}

// ─── API 函数 ──────────────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, init);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json() as Promise<T>;
}

export interface HealthStatus {
  status: string;
  version: string;
  library: {
    connected: boolean;
    path: string;
    folders: string[];
  };
}

/** 健康检查（含素材库状态） */
export async function fetchHealth(): Promise<HealthStatus> {
  return request<HealthStatus>("/health");
}

/** 获取模板列表 */
export async function fetchTemplates(fileId?: string): Promise<TemplateInfo[]> {
  const qs = fileId ? `?file_id=${encodeURIComponent(fileId)}` : "";
  return request<TemplateInfo[]>(`/templates${qs}`);
}

/** 触发合成任务 */
export async function createCompose(req: ComposeRequest): Promise<ComposeJob> {
  return request<ComposeJob>("/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

/** 查询合成状态 */
export async function getCompose(jobId: string): Promise<ComposeJob> {
  return request<ComposeJob>(`/compose/${jobId}`);
}

/** 获取历史合成任务列表 */
export async function listComposes(limit = 20): Promise<ComposeJob[]> {
  return request<ComposeJob[]>(`/compose?limit=${limit}`);
}

/** 获取合成结果图片 URL（直接返回 blob URL） */
export function getImageUrl(jobId: string): string {
  return `${BASE}/compose/${jobId}/image`;
}

/** 切九宫格 */
export async function exportGrid(
  jobId: string,
  rows: number,
  cols: number
): Promise<{ job_id: string; files: string[] }> {
  return request(`/export/grid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, rows, cols }),
  });
}

/** 获取某格图片 URL */
export function getGridCellUrl(jobId: string, index: number): string {
  return `${BASE}/export/grid/${jobId}/${String(index).padStart(2, "0")}`;
}

/** 上传表格解析
 * @param requiredFields 从模板 slot 推导出的字段列表，如 ["image","name","price"]
 */
export async function parseTable(
  file: File,
  requiredFields?: string[],
  imageType?: string,
): Promise<ParseResult> {
  const form = new FormData();
  form.append("file", file);
  if (requiredFields && requiredFields.length > 0) {
    form.append("required_fields", requiredFields.join(","));
  }
  if (imageType) {
    form.append("image_type", imageType);
  }
  const resp = await fetch(`${BASE}/parse-table`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`解析失败 HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

export interface ImageTypeInfo {
  key: string;
  folder: string;
  exists: boolean;
}

/** 获取可用图片类型列表 */
export async function fetchImageTypes(): Promise<ImageTypeInfo[]> {
  const res = await request<{ types: ImageTypeInfo[] }>("/image-types");
  return res.types;
}

/** 列出产品图库 */
export async function fetchProducts(): Promise<{ products: ProductItem[] }> {
  return request<{ products: ProductItem[] }>("/products");
}

/** 获取模板缩略图 URL（首次调用后端会生成并缓存，约 5 秒）
 * @param refresh=true 强制重新生成（绕过缓存）
 */
export function getTemplateThumbnailUrl(
  templateId: string,
  pageId: string,
  fileId?: string,
  refresh?: boolean
): string {
  const qs = new URLSearchParams({ page_id: pageId });
  if (fileId) qs.set("file_id", fileId);
  if (refresh) qs.set("refresh", "1");
  return `${BASE}/templates/${templateId}/thumbnail?${qs}`;
}

/** AI 对话（普通文字聊天，非指令） */
export async function chatWithAI(
  messages: Array<{ role: string; content: string }>,
  context?: {
    templateName?: string;
    templateSlotCount?: number;
    productCount?: number;
    jobStatus?: string;
    hasResult?: boolean;
  }
): Promise<string> {
  const resp = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context: context ?? {} }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.reply as string;
}

// ─── MCP 相关 ──────────────────────────────────────────────────────────────────

export interface McpStatus {
  status: "ok" | "error" | "timeout";
  connected: boolean;
  message?: string;
  response?: string;
}

export interface McpExecuteResult {
  id?: string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: string;
}

/** 检查 MCP Server 连接状态 */
export async function getMcpStatus(): Promise<McpStatus> {
  return request<McpStatus>("/mcp/status");
}

/** 通过后端 relay 执行 MCP 代码 */
export async function executeMcp(code: string): Promise<McpExecuteResult> {
  const form = new FormData();
  form.append("code", code);
  const resp = await fetch(`${BASE}/mcp/execute`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`MCP 执行失败 HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}
