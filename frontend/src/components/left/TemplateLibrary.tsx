/**
 * 左栏 — 模板库
 * 从后端拉取 penpot 模板列表，展示缩略图，支持筛选和选中
 */
import { useEffect, useRef, useState } from "react";
import { fetchTemplates, getTemplateThumbnailUrl, type TemplateInfo } from "../../api/client";
import { useAppStore } from "../../store/useAppStore";

const FILTER_LABELS: Record<string, string> = {
  all: "全部",
  single: "单品",
  grid_4: "4宫格",
  grid_6: "6宫格",
  grid_9: "9宫格",
};

function guessType(t: TemplateInfo): string {
  const productSlots = t.slots.filter((s) =>
    s.name.startsWith("slot/product_")
  );
  const n = new Set(
    productSlots.map((s) => s.name.split("/")[1])
  ).size;
  if (n <= 1) return "single";
  if (n <= 4) return "grid_4";
  if (n <= 6) return "grid_6";
  return "grid_9";
}

export default function TemplateLibrary() {
  const { templates, templatesLoading, setTemplates, setTemplatesLoading } =
    useAppStore();
  const { compose, selectTemplate } = useAppStore();
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [thumbRefreshKey, setThumbRefreshKey] = useState(0);

  // 加载模板列表
  const loadTemplates = () => {
    setTemplatesLoading(true);
    setError(null);
    fetchTemplates()
      .then(setTemplates)
      .catch((e) => setError(String(e)))
      .finally(() => setTemplatesLoading(false));
  };

  // 刷新模板（仅刷新列表 + 缩略图，保留 slots 和消息）
  const handleRefresh = () => {
    setThumbRefreshKey((k) => k + 1);
    loadTemplates();
    // 注意：不清空 slots 和 messages，保留上传的表格数据
  };

  // 首次加载
  useEffect(() => {
    loadTemplates();
  }, []);

  const visible = templates.filter(
    (t) => filter === "all" || guessType(t) === filter
  );

  return (
    <div className="template-library">
      <div className="panel-header">
        <span className="panel-title">模板库</span>
        {templatesLoading && <span className="loading-dot" />}
        <button
          className="refresh-btn"
          onClick={handleRefresh}
          title="刷新模板和缩略图"
          disabled={templatesLoading}
        >
          ↻
        </button>
        <a
          className="progress-btn"
          href="/PROGRESS.html"
          target="_blank"
          rel="noreferrer"
          title="查看项目进度"
        >
          📋 进度
        </a>
      </div>

      {/* 筛选 */}
      <div className="filter-bar">
        {Object.entries(FILTER_LABELS).map(([k, label]) => (
          <button
            key={k}
            className={`filter-btn${filter === k ? " active" : ""}`}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="error-msg">{error}</div>}

      {/* 模板卡片列表 */}
      <div className="template-list">
        {visible.length === 0 && !templatesLoading && (
          <div className="empty-hint">暂无模板</div>
        )}
        {visible.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            selected={compose.selectedTemplate?.id === t.id}
            onClick={() => selectTemplate(t)}
            thumbRefreshKey={thumbRefreshKey}
          />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  selected,
  onClick,
  thumbRefreshKey,
}: {
  template: TemplateInfo;
  selected: boolean;
  onClick: () => void;
  thumbRefreshKey: number;
}) {
  const productCount = new Set(
    template.slots
      .filter((s) => s.name.startsWith("slot/product_"))
      .map((s) => s.name.split("/")[1])
  ).size;

  const type = guessType(template);
  const typeLabel = FILTER_LABELS[type] ?? type;

  return (
    <div
      className={`template-card${selected ? " selected" : ""}`}
      onClick={onClick}
    >
      <div className="template-thumb">
        <LazyThumbnail template={template} thumbRefreshKey={thumbRefreshKey} />
      </div>
      <div className="template-meta">
        <span className="template-name">{template.name}</span>
        <span className="template-badge">{typeLabel}</span>
        {productCount > 0 && (
          <span className="template-slots">{productCount} 格产品</span>
        )}
      </div>
    </div>
  );
}

/**
 * 懒加载真实缩略图。
 * 卡片进入视口后才发起请求（IntersectionObserver），
 * 后端首次生成约 5 秒，命中缓存后立即返回。
 * 加载期间显示 slot 骨架预览，加载成功后替换为真实截图。
 * thumbRefreshKey > 0 时强制重新生成（绕过缓存）
 */
function LazyThumbnail({ template, thumbRefreshKey }: { template: TemplateInfo; thumbRefreshKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // 构建缩略图 URL，thumbRefreshKey 作为 cache-buster
  const getThumbUrl = () =>
    getTemplateThumbnailUrl(
      template.id,
      template.page_id,
      template.file_id,
      thumbRefreshKey > 0
    );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();
          setSrc(getThumbUrl());
        }
      },
      { rootMargin: "120px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [template.id, thumbRefreshKey]);

  return (
    <div ref={ref} className="thumb-inner">
      {src && !failed ? (
        <img
          src={src}
          alt={template.name}
          className="thumb-img"
          onError={() => setFailed(true)}
        />
      ) : (
        <SlotPreview template={template} />
      )}
    </div>
  );
}

/** slot 骨架预览（彩色方块示意，缩略图未加载时使用）*/
function SlotPreview({ template }: { template: TemplateInfo }) {
  const slots = template.slots;
  if (slots.length === 0) {
    return <div className="thumb-placeholder">空模板</div>;
  }

  const tw = template.width || 400;
  const th = template.height || 400;
  const scale = 160 / Math.max(tw, th);

  return (
    <svg
      width={tw * scale}
      height={th * scale}
      viewBox={`0 0 ${tw} ${th}`}
      className="thumb-svg"
    >
      <rect width={tw} height={th} fill="#f0f0f0" rx="4" />
      {slots.map((s) => (
        <rect
          key={s.id}
          x={s.x - template.x}
          y={s.y - template.y}
          width={s.width}
          height={s.height}
          fill={s.type === "text" ? "#bfdbfe" : "#bbf7d0"}
          fillOpacity={0.8}
          stroke={s.type === "text" ? "#3b82f6" : "#22c55e"}
          strokeWidth={2}
          rx={2}
        />
      ))}
    </svg>
  );
}
