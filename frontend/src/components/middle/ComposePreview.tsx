/**
 * 中栏 — 合成预览
 * 展示当前模板的 slot 布局、合成进度和导出结果
 */
import { useEffect, useRef } from "react";
import { getCompose, getImageUrl, type TemplateInfo, type ParsedProduct } from "../../api/client";
import { useAppStore } from "../../store/useAppStore";

// 把后端进度日志转为用户友好文案，返回 null 表示跳过不显示
function friendlyProgress(msg: string): string | null {
  if (msg.includes("等待合成队列")) return "等待生图队列…";
  if (msg.includes("复制模板文件")) return "正在创建独立副本…";
  if (msg.includes("副本就绪")) return "副本创建完成";
  if (msg.includes("读取模板图层")) return "读取模板结构";
  if (msg.includes("上传图片")) {
    const m = msg.match(/上传图片.*?→\s*(slot\/.+)/);
    return m ? `上传图片 → ${m[1].replace("slot/", "").replace("/image", "")}` : "上传产品图片";
  }
  if (msg.includes("写入文字")) {
    const m = msg.match(/「(.+?)」/);
    return m ? `写入文字：${m[1]}` : "写入文字内容";
  }
  if (msg.includes("隐藏空图层")) return null; // 内部细节，不展示
  if (msg.includes("提交") && msg.includes("变更")) {
    const m = msg.match(/(\d+)/);
    return m ? `提交 ${m[1]} 处变更` : "提交变更";
  }
  if (msg.includes("无变更")) return "无需变更，直接导出";
  if (msg.includes("导出 PNG")) return "正在渲染导出图片…";
  if (msg.includes("完成") && msg.includes("输出")) return "导出完成";
  if (msg.includes("Penpot 编辑链接")) return null; // 不展示链接原文
  if (msg.includes("失败")) return null; // 失败单独区域展示
  return msg; // 其他原样展示
}

export default function ComposePreview() {
  const { compose, setJob, setResultImageUrl } = useAppStore();
  const { selectedTemplate, currentJob, resultImageUrl, gridUrls, slots } =
    compose;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 轮询任务状态 ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentJob || currentJob.status === "done" || currentJob.status === "failed") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const updated = await getCompose(currentJob.id);
        setJob(updated);
        if (updated.status === "done") {
          setResultImageUrl(getImageUrl(updated.id));
          clearInterval(pollRef.current!);
        } else if (updated.status === "failed") {
          clearInterval(pollRef.current!);
        }
      } catch {
        // 网络抖动忽略
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [currentJob?.id, currentJob?.status]);

  // ── 空状态 ─────────────────────────────────────────────────────────────────
  if (!selectedTemplate) {
    return (
      <div className="compose-preview empty">
        <div className="empty-illustration">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="4" y="4" width="56" height="56" rx="8" fill="#1e2029" />
            <rect x="12" y="12" width="24" height="32" rx="3" fill="#2a2d3a" />
            <rect x="40" y="12" width="12" height="14" rx="2" fill="#1a3a2a" />
            <rect x="40" y="30" width="12" height="14" rx="2" fill="#0f1e3a" />
            <rect x="12" y="48" width="40" height="4" rx="2" fill="#2a2d3a" />
          </svg>
        </div>
        <p className="empty-text">选择模板，开始 AI 生图</p>
        <p className="empty-sub">上传产品表格，AI 自动生图</p>
      </div>
    );
  }

  const hasResult = !!resultImageUrl;
  const isRunning =
    currentJob?.status === "pending" || currentJob?.status === "running";

  return (
    <div className="compose-preview">
      {/* 顶栏 */}
      <div className="preview-header">
        <span className="preview-title">{selectedTemplate.name}</span>
        <span className="preview-size">
          {selectedTemplate.width} × {selectedTemplate.height}
        </span>
      </div>

      {/* 主内容区 */}
      <div className="preview-body">
        {/* 有导出结果时展示图片 */}
        {hasResult && !isRunning && (
          <div className="result-area">
            <img
              src={resultImageUrl!}
              alt="合成结果"
              className="result-image"
            />
            {/* Penpot 精修入口 */}
            {currentJob?.penpot_edit_url && (
              <a
                href={currentJob.penpot_edit_url}
                target="_blank"
                rel="noreferrer"
                className="penpot-edit-btn"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                在 Penpot 中修改
              </a>
            )}
            {gridUrls.length > 0 && (
              <div className="grid-area">
                <div className="grid-label">九宫格</div>
                <div className="grid-cells">
                  {gridUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={`格子${i + 1}`} className="grid-cell" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 无结果时展示 slot 布局预览 */}
        {!hasResult && !isRunning && (
          <SlotLayout template={selectedTemplate} slots={slots} />
        )}

        {/* 合成进行中 */}
        {isRunning && (
          <ProgressLog progress={currentJob!.progress ?? []} />
        )}

        {/* 失败 */}
        {currentJob?.status === "failed" && (
          <div className="error-area">
            <p>生图失败</p>
            <pre>{currentJob.error}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Terminal-style Progress Log ──────────────────────────────────────────────

function ProgressLog({ progress }: { progress: string[] }) {
  const logRef = useRef<HTMLDivElement>(null);
  const lines = progress.map((p) => friendlyProgress(p)).filter(Boolean) as string[];

  // Auto-scroll to bottom whenever new lines arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="progress-area">
      <div className="progress-header">
        <div className="progress-spinner" />
        <span className="progress-title">AI 生图中</span>
      </div>
      <div className="progress-log" ref={logRef}>
        {lines.map((line, i) => {
          const isActive = i === lines.length - 1;
          return (
            <div key={i} className={`log-line ${isActive ? "active" : "done"}`}>
              {isActive
                ? <span className="log-active-dot">·</span>
                : <span className="log-check">✓</span>
              }
              <span className="log-text">{line}</span>
            </div>
          );
        })}
        {lines.length === 0 && (
          <div className="log-line active">
            <span className="log-active-dot">·</span>
            <span className="log-text">正在启动…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Slot 布局可视化 ───────────────────────────────────────────────────────────

function SlotLayout({
  template,
  slots,
}: {
  template: TemplateInfo;
  slots: Record<string, { product: ParsedProduct; localImageUrl?: string }>;
}) {
  const tw = template.width;
  const th = template.height;
  const maxW = 460;
  const maxH = 460;
  const scale = Math.min(maxW / tw, maxH / th, 1);

  // frame 的绝对坐标（后端已返回），用于将 slot 的绝对坐标转为相对于 frame 的坐标
  const frameX = template.x;
  const frameY = template.y;

  return (
    <div className="slot-layout">
      <svg
        width={tw * scale}
        height={th * scale}
        viewBox={`0 0 ${tw} ${th}`}
        className="slot-svg"
      >
        {/* 背景 */}
        <rect width={tw} height={th} fill="#fafafa" stroke="#e5e7eb" strokeWidth={1} />

        {template.slots.map((s) => {
          const rx = s.x - frameX;
          const ry = s.y - frameY;
          // 找当前 slot 对应的填充内容
          const productKey = s.name.split("/")[1]; // product_1
          const field = s.name.split("/")[2]; // image / name / price
          const slotData = slots[productKey];

          const isImage = s.type === "rect" || field === "image";
          const isText = s.type === "text";

          const fill = isImage ? "#d1fae5" : isText ? "#dbeafe" : "#fef9c3";
          const stroke = isImage ? "#22c55e" : isText ? "#3b82f6" : "#eab308";

          const hasContent =
            isImage
              ? !!slotData?.localImageUrl
              : !!slotData?.product?.[field as keyof typeof slotData.product];

          return (
            <g key={s.id}>
              <rect
                x={rx}
                y={ry}
                width={s.width}
                height={s.height}
                fill={hasContent ? fill : fill + "66"}
                stroke={stroke}
                strokeWidth={hasContent ? 2 : 1}
                strokeDasharray={hasContent ? undefined : "4 3"}
                rx={3}
              />
              {/* 图片预览 */}
              {isImage && slotData?.localImageUrl && (
                <image
                  href={slotData.localImageUrl}
                  x={rx + 2}
                  y={ry + 2}
                  width={s.width - 4}
                  height={s.height - 4}
                  preserveAspectRatio="xMidYMid meet"
                />
              )}
              {/* 文字内容 */}
              {isText && slotData?.product?.[field as keyof typeof slotData.product] && (
                <text
                  x={rx + s.width / 2}
                  y={ry + s.height / 2 + 5}
                  textAnchor="middle"
                  fontSize={Math.min(12, s.height * 0.4)}
                  fill="#1e40af"
                >
                  {String(
                    slotData.product[field as keyof typeof slotData.product]
                  ).slice(0, 16)}
                </text>
              )}
              {/* slot 名称标签 */}
              {!hasContent && (
                <text
                  x={rx + s.width / 2}
                  y={ry + s.height / 2 + 5}
                  textAnchor="middle"
                  fontSize={Math.min(10, s.height * 0.3)}
                  fill="#9ca3af"
                >
                  {field ?? s.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="slot-legend">
        <span className="legend-item image">产品图</span>
        <span className="legend-item text">文字</span>
        <span className="legend-item other">其他</span>
      </div>
    </div>
  );
}
