/**
 * 左栏 — 产品图库管理
 * 展示所有本地图片，支持拖拽 / 点击上传新图片，点击图片可删除。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchProducts, type ProductItem } from "../../api/client";

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export default function ProductLibraryPanel() {
  const [items, setItems] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { products } = await fetchProducts();
      setItems(products);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── 上传图片 ────────────────────────────────────────────────────────────────
  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch(`${BASE}/products/upload`, { method: "POST", body: form });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`上传失败: ${txt.slice(0, 100)}`);
      }
      await load(); // 刷新列表
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) uploadFile(file);
  }

  // ── 拖拽 ────────────────────────────────────────────────────────────────────
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave() { setDragging(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  // ── 删除 ────────────────────────────────────────────────────────────────────
  async function deleteItem(item: ProductItem) {
    if (!confirm(`删除「${item.name}」？`)) return;
    try {
      const resp = await fetch(`${BASE}/products/${encodeURIComponent(item.filename)}`, {
        method: "DELETE",
      });
      if (!resp.ok) throw new Error(await resp.text());
      setItems((prev) => prev.filter((i) => i.filename !== item.filename));
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="product-library-panel">
      <div className="panel-header">
        <span className="panel-title">产品图库</span>
        {loading && <span className="loading-dot" />}
        <span className="lib-count">{items.length} 张</span>
      </div>

      {/* 上传区 */}
      <div
        className={`upload-zone${dragging ? " dragging" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileInput}
        />
        {uploading ? (
          <span className="upload-hint">上传中…</span>
        ) : (
          <span className="upload-hint">
            {dragging ? "松开即可上传" : "拖拽图片到此 / 点击上传"}
          </span>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      {/* 图片网格 */}
      <div className="product-grid">
        {items.length === 0 && !loading && (
          <div className="empty-hint">图库为空，请上传产品图片</div>
        )}
        {items.map((item) => (
          <ProductThumb key={item.filename} item={item} onDelete={deleteItem} />
        ))}
      </div>
    </div>
  );
}

function ProductThumb({
  item,
  onDelete,
}: {
  item: ProductItem;
  onDelete: (item: ProductItem) => void;
}) {
  const url = `${BASE}/product-library/${item.filename}`;
  return (
    <div className="product-thumb" title={item.name}>
      <img src={url} alt={item.name} className="product-img" loading="lazy" />
      <div className="product-overlay">
        <span className="product-name-label">{item.name}</span>
        <button
          className="delete-btn"
          onClick={(e) => { e.stopPropagation(); onDelete(item); }}
          title="删除"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
