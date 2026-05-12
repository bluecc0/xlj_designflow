// API client — non-module version of src/api.js
(function() {
  const BASE = window.API_BASE || (window.location.protocol + '//' + window.location.hostname + ':8000');

  function request(path, init) {
    return fetch(BASE + path, init).then(function(resp) {
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
    return fetch(BASE + '/parse-table', { method: 'POST', body: form }).then(function(resp) {
      if (!resp.ok) {
        return resp.text().then(function(text) {
          throw new Error('解析失败 HTTP ' + resp.status + ': ' + text.slice(0, 200));
        });
      }
      return resp.json();
    });
  }

  window.API = {
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
    fetchImageTypes: function() {
      return request('/image-types').then(function(res) { return res.types; });
    },
  };
})();
