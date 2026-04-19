// API client — wraps all backend calls (FastAPI at localhost:8000)

const BASE = window.API_BASE || 'http://localhost:8000';

async function request(path, init) {
  const resp = await fetch(`${BASE}${path}`, init);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ── Health ────────────────────────────────────────────────────────────────────
export async function fetchHealth() {
  return request('/health');
}

// ── Templates ─────────────────────────────────────────────────────────────────
export async function fetchTemplates(fileId) {
  const qs = fileId ? `?file_id=${encodeURIComponent(fileId)}` : '';
  return request(`/templates${qs}`);
}

export function getTemplateThumbnailUrl(templateId, pageId, fileId, refresh) {
  const qs = new URLSearchParams({ page_id: pageId });
  if (fileId) qs.set('file_id', fileId);
  if (refresh) qs.set('refresh', '1');
  return `${BASE}/templates/${templateId}/thumbnail?${qs}`;
}

// ── Parse table ───────────────────────────────────────────────────────────────
export async function parseTable(file, requiredFields, imageType) {
  const form = new FormData();
  form.append('file', file);
  if (requiredFields && requiredFields.length > 0) {
    form.append('required_fields', requiredFields.join(','));
  }
  if (imageType) form.append('image_type', imageType);
  const resp = await fetch(`${BASE}/parse-table`, { method: 'POST', body: form });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`解析失败 HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ── Compose ───────────────────────────────────────────────────────────────────
export async function createCompose(req) {
  return request('/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function getCompose(jobId) {
  return request(`/compose/${jobId}`);
}

export async function listComposes(limit = 20) {
  return request(`/compose?limit=${limit}`);
}

export function getImageUrl(jobId) {
  return `${BASE}/compose/${jobId}/image`;
}

// ── Grid export ───────────────────────────────────────────────────────────────
export async function exportGrid(jobId, rows, cols) {
  return request('/export/grid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, rows, cols }),
  });
}

export function getGridCellUrl(jobId, index) {
  return `${BASE}/export/grid/${jobId}/${String(index).padStart(2, '0')}`;
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export async function chatWithAI(messages, context) {
  const resp = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context: context || {} }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.reply;
}

// ── Products ──────────────────────────────────────────────────────────────────
export async function fetchProducts() {
  return request('/products');
}

export async function fetchImageTypes() {
  const res = await request('/image-types');
  return res.types;
}

window.API = {
  fetchHealth,
  fetchTemplates,
  getTemplateThumbnailUrl,
  parseTable,
  createCompose,
  getCompose,
  listComposes,
  getImageUrl,
  exportGrid,
  getGridCellUrl,
  chatWithAI,
  fetchProducts,
  fetchImageTypes,
};
