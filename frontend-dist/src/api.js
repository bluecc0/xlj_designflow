// API client — non-module version of src/api.js
(function() {
  const BASE = window.API_BASE || window.location.origin;

  function request(path, init) {
    var nextInit = Object.assign({ credentials: 'include' }, init || {});
    return fetch(BASE + path, nextInit).then(function(resp) {
      if (!resp.ok) {
        if (resp.status === 401) {
          try {
            window.dispatchEvent(new CustomEvent('designflow-auth-required'));
          } catch (e) {}
        }
        return resp.text().then(function(text) {
          throw new Error('HTTP ' + resp.status + ': ' + text.slice(0, 200));
        });
      }
      return resp.json();
    });
  }

  function getTemplateThumbnailUrl(templateId, pageId, fileId, refresh) {
    var qs = 'page_id=' + encodeURIComponent(pageId);
    if (fileId) qs += '&file_id=' + encodeURIComponent(fileId);
    if (refresh) qs += '&refresh=1';
    return BASE + '/templates/' + templateId + '/thumbnail?' + qs;
  }

  function parseTable(file, requiredFields, imageType) {
    var form = new FormData();
    form.append('file', file);
    if (requiredFields && requiredFields.length > 0) {
      form.append('required_fields', requiredFields.join(','));
    }
    if (imageType) form.append('image_type', imageType);
    return fetch(BASE + '/parse-table', { method: 'POST', body: form, credentials: 'include' }).then(function(resp) {
      if (!resp.ok) {
        return resp.text().then(function(text) {
          throw new Error('解析失败 HTTP ' + resp.status + ': ' + text.slice(0, 200));
        });
      }
      return resp.json();
    });
  }

  window.API = {
    BASE: BASE,
    getCurrentUser: function() {
      return request('/auth/me').then(function(res) { return res.user; });
    },
    getLoginUsers: function() {
      return request('/auth/options').then(function(res) { return res.users || []; });
    },
    loginLite: function(username) {
      return request('/auth/login-lite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username }),
      }).then(function(res) { return res.user; });
    },
    logout: function() {
      return request('/auth/logout', { method: 'POST' });
    },
    fetchHealth: function() { return request('/health'); },
    fetchTemplates: function(fileId) {
      var qs = fileId ? '?file_id=' + encodeURIComponent(fileId) : '';
      return request('/templates' + qs);
    },
    getTemplateThumbnailUrl: getTemplateThumbnailUrl,
    parseTable: parseTable,
    createCompose: function(req) {
      return request('/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
    },
    getCompose: function(jobId) { return request('/compose/' + jobId); },
    listComposes: function(limit) { return request('/compose?limit=' + (limit || 20)); },
    listSpecialComposes: function(limit) { return request('/special-compose/history?limit=' + (limit || 20)); },
    listAiImages: function(limit) { return request('/history/ai-images?limit=' + (limit || 20)); },
    listAiChats: function(limit) { return request('/history/ai-chats?limit=' + (limit || 20)).then(function(res) { return res.sessions || []; }); },
    getAiChat: function(sessionId) { return request('/history/ai-chats/' + encodeURIComponent(sessionId)); },
    deleteAiChat: function(sessionId) { return request('/history/ai-chats/' + encodeURIComponent(sessionId), { method: 'DELETE' }); },
    createLayeredPsd: function(prompt, imageFile, options) {
      var form = new FormData();
      form.append('prompt', prompt);
      form.append('model', (options && options.model) || 'nano-banana-pro');
      form.append('size', (options && options.size) || 'auto');
      form.append('resolution', (options && options.resolution) || '');
      form.append('image', imageFile);
      return request('/psd/layered', { method: 'POST', body: form });
    },
    getLayeredPsd: function(jobId) {
      return request('/psd/layered/' + encodeURIComponent(jobId));
    },
    getImageUrl: function(jobId) { return BASE + '/compose/' + jobId + '/image'; },
    exportGrid: function(jobId, rows, cols) {
      return request('/export/grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, rows: rows, cols: cols }),
      });
    },
    getGridCellUrl: function(jobId, index) {
      return BASE + '/export/grid/' + jobId + '/' + String(index).padStart(2, '0');
    },
    chatWithAI: function(messages, context) {
      return fetch(BASE + '/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages, context: context || {} }),
      }).then(function(resp) {
        if (!resp.ok) {
          return resp.text().then(function(text) {
            throw new Error('HTTP ' + resp.status + ': ' + text.slice(0, 200));
          });
        }
        return resp.json();
      }).then(function(data) { return data.reply; });
    },
    clearTemplateCache: function() {
      return fetch(BASE + '/templates/cache', { method: 'DELETE' }).then(r => r.json());
    },
    fetchProducts: function() { return request('/products'); },
    resolveProductRefs: function(refs) {
      return request('/products/resolve-references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refs: refs || [] }),
      }).then(function(res) { return res.refs || []; });
    },
    fetchImageTypes: function() {
      return request('/image-types').then(function(res) { return res.types; });
    },
  };
})();
