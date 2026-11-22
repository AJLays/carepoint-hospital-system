'use strict';

(() => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = (resource, options = {}) => {
    const url = typeof resource === 'string' ? resource : resource.url;
    const isApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
    const headers = new Headers(options.headers || (resource instanceof Request ? resource.headers : undefined));

    if (isApi && !url.includes('/api/auth/login')) {
      const token = sessionStorage.getItem('carepoint_token');
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    return originalFetch(resource, { ...options, headers });
  };

  const token = sessionStorage.getItem('carepoint_token');
  if (!token) {
    window.location.replace('/login.html');
    return;
  }

  originalFetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  }).then(async response => {
    if (!response.ok) throw new Error('Session expired');
    const data = await response.json();
    sessionStorage.setItem('carepoint_user', JSON.stringify(data.user));
  }).catch(() => {
    sessionStorage.removeItem('carepoint_token');
    sessionStorage.removeItem('carepoint_user');
    window.location.replace('/login.html');
  });
})();
