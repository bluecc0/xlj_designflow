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
      return request('/auth/session').then(function(res) { return res.user || null; });
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
    retryAiImage: function(jobId, sessionId) {
      return request('/ai-image/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, session_id: sessionId }),
      });
    },
    publishInspiration: function(payload) {
      // payload: { job_id } 或 { image_url }（用于从历史消息中发布时拿不到 job_id）
      var body = {};
      if (payload && payload.job_id) body.job_id = payload.job_id;
      if (payload && payload.image_url) body.image_url = payload.image_url;
      if (payload && payload.category) body.category = payload.category;
      if (payload && payload.tags) body.tags = payload.tags;
      return request('/inspiration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    unpublishInspiration: function(postId) {
      return request('/inspiration/' + encodeURIComponent(postId), { method: 'DELETE' });
    },
    listInspiration: function(limit, offset, options) {
      var qs = '?limit=' + (limit || 20) + '&offset=' + (offset || 0);
      if (options === true) options = { mine: true };
      options = options || {};
      if (options.mine) qs += '&mine=1';
      if (options.favorite) qs += '&favorite=1';
      if (options.category) qs += '&category=' + encodeURIComponent(options.category);
      if (options.search) qs += '&search=' + encodeURIComponent(options.search);
      return request('/inspiration' + qs).then(function(res) { return res.posts || []; });
    },
    getInspiration: function(postId) {
      return request('/inspiration/' + encodeURIComponent(postId)).then(function(res) { return res.post; });
    },
    favoriteInspiration: function(postId) {
      return request('/inspiration/' + encodeURIComponent(postId) + '/favorite', { method: 'POST' });
    },
    unfavoriteInspiration: function(postId) {
      return request('/inspiration/' + encodeURIComponent(postId) + '/favorite', { method: 'DELETE' });
    },
    describeInspiration: function(postId) {
      return request('/inspiration/' + encodeURIComponent(postId) + '/describe', { method: 'POST' });
    },
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
    proxyDownloadInspect: function(url) {
      return request('/proxy-download/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url }),
      });
    },
    proxyDownload: function(url, format) {
      return request('/proxy-download/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, format: format || null }),
      });
    },
    createAgentProject: function() {
      return request('/api/projects', { method: 'POST' }).then(function(res) { return res.data; });
    },
    listAgentProjects: function(page, limit, status) {
      var qs = '?page=' + encodeURIComponent(page || 1) + '&limit=' + encodeURIComponent(limit || 20);
      if (status) qs += '&status=' + encodeURIComponent(status);
      return request('/api/projects' + qs);
    },
    getAgentProject: function(projectId) {
      return request('/api/projects/' + encodeURIComponent(projectId)).then(function(res) { return res.data; });
    },
    deleteAgentProject: function(projectId) {
      return request('/api/projects/' + encodeURIComponent(projectId), { method: 'DELETE' }).then(function(res) { return res.data; });
    },
    listAgentProjectImages: function(projectId) {
      return request('/api/projects/' + encodeURIComponent(projectId) + '/images').then(function(res) { return res.data || []; });
    },
    streamAgentChat: function(projectId, message, handlers, refImages) {
      handlers = handlers || {};
      var hasRefs = Array.isArray(refImages) && refImages.length > 0;
      var init = {
        method: 'POST',
        credentials: 'include',
      };
      if (hasRefs) {
        var form = new FormData();
        form.append('message', message);
        refImages.forEach(function(item) {
          if (item && item.file) form.append('image', item.file);
        });
        init.body = form;
      } else {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify({ message: message });
      }
      return fetch(BASE + '/api/projects/' + encodeURIComponent(projectId) + '/chat', init).then(function(resp) {
        if (!resp.ok) {
          return resp.text().then(function(text) {
            throw new Error('HTTP ' + resp.status + ': ' + text.slice(0, 200));
          });
        }
        if (!resp.body) {
          throw new Error('SSE body not available');
        }
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function dispatchBlock(block) {
          var eventName = 'message';
          var dataLines = [];
          block.split('\n').forEach(function(line) {
            if (!line) return;
            if (line.indexOf('event:') === 0) eventName = line.slice(6).trim();
            if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
          });
          if (!dataLines.length) return;
          var payloadText = dataLines.join('\n');
          var payload = null;
          try { payload = JSON.parse(payloadText); } catch (e) { payload = { raw: payloadText }; }
          if (handlers.onEvent) handlers.onEvent(eventName, payload);
          if (eventName === 'done' && handlers.onDone) handlers.onDone(payload);
          if (eventName === 'error' && handlers.onError) handlers.onError(payload);
        }

        function pump() {
          return reader.read().then(function(result) {
            if (result.done) {
              if (buffer.trim()) dispatchBlock(buffer.trim());
              if (handlers.onClose) handlers.onClose();
              return;
            }
            buffer += decoder.decode(result.value, { stream: true });
            var parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            parts.forEach(function(part) { dispatchBlock(part.trim()); });
            return pump();
          });
        }

        return pump();
      });
    },
    fetchImageTypes: function() {
      return request('/image-types').then(function(res) { return res.types; });
    },
    getAdminStats: function() {
      return request('/admin/stats');
    },
    getAdminUsers: function() {
      return request('/admin/users');
    },
    createAdminUser: function(username, role) {
      return request('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, role: role }),
      });
    },
    updateAdminUser: function(userId, updates) {
      return request('/admin/users/' + encodeURIComponent(userId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    },
    deleteAdminUser: function(userId) {
      return request('/admin/users/' + encodeURIComponent(userId), {
        method: 'DELETE',
      });
    },
    getAdminOperations: function(limit, offset, action, userId) {
      var qs = '?limit=' + (limit || 50) + '&offset=' + (offset || 0);
      if (action) qs += '&action=' + encodeURIComponent(action);
      if (userId) qs += '&user_id=' + encodeURIComponent(userId);
      return request('/admin/operations' + qs);
    },
  };
})();
