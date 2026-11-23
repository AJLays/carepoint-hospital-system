'use strict';

// Loaded (without defer) in <head> of every protected page, BEFORE the page's own script.
// 1) redirects to login if there is no token
// 2) adds the Bearer token to every /api call
// 3) sends the user back to login on any 401
// 4) shows who is logged in + a Log out button
(() => {
  const token = sessionStorage.getItem('carepoint_token');

  const goToLogin = () => {
    sessionStorage.removeItem('carepoint_token');
    sessionStorage.removeItem('carepoint_user');
    window.location.replace('/login.html');
  };

  if (!token) { goToLogin(); return; }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (resource, options = {}) => {
    const url = typeof resource === 'string' ? resource : resource.url;
    const isApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
    const isLogin = url.includes('/api/auth/login');

    const headers = new Headers(
      options.headers || (resource instanceof Request ? resource.headers : undefined)
    );
    if (isApi && !isLogin) {
      const t = sessionStorage.getItem('carepoint_token');
      if (t) headers.set('Authorization', `Bearer ${t}`);
    }

    const response = await originalFetch(resource, { ...options, headers });
    if (isApi && !isLogin && response.status === 401) goToLogin();
    return response;
  };

  window.carepointUser = () => {
    try { return JSON.parse(sessionStorage.getItem('carepoint_user') || 'null'); }
    catch { return null; }
  };

  window.carepointLogout = async () => {
    try { await window.fetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    goToLogin();
  };

  // Verify the session is still valid (also refreshes the stored user)
  originalFetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    .then(async (r) => {
      if (!r.ok) throw new Error('Session expired');
      const data = await r.json();
      sessionStorage.setItem('carepoint_user', JSON.stringify(data.user));
      renderUserChip();
      applyRoleToPage();
      document.dispatchEvent(new CustomEvent('carepoint:user', { detail: data.user }));
    })
    .catch(goToLogin);

  // Keep in sync with PAGES in middleware/rbac.js (the server is the real enforcement).
  const PAGES = {
    admin: '*',
    receptionist: ['index.html', 'admissions.html', 'rooms.html', 'doctors.html', 'billing.html'],
    doctor: ['index.html', 'doctors.html', 'admissions.html', 'rooms.html', 'treatments-medications.html'],
    nurse: ['index.html', 'admissions.html', 'rooms.html', 'treatments-medications.html'],
    billing: ['index.html', 'billing.html', 'reports.html', 'admissions.html']
  };

  function applyRoleToPage() {
    const u = window.carepointUser();
    if (!u) return;
    const allowed = PAGES[u.role];
    if (allowed === '*') return;
    const list = allowed || [];
    const current = window.location.pathname.split('/').pop() || 'index.html';
    if (!list.includes(current)) { window.location.replace('/index.html'); return; }
    document.querySelectorAll('a[href]').forEach((a) => {
      const page = (a.getAttribute('href') || '').split('#')[0];
      if (/\.html$/.test(page) && !list.includes(page)) a.style.display = 'none';
    });
  }

  function renderUserChip() {
    const u = window.carepointUser();
    if (!u || document.getElementById('cpUserChip')) return;
    const chip = document.createElement('div');
    chip.id = 'cpUserChip';
    chip.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:10px;align-items:center;' +
      'background:#fff;border:1px solid #d0d5dd;border-radius:999px;padding:6px 8px 6px 14px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.12);font:13px Arial,sans-serif;color:#344054';
    const label = document.createElement('span');
    label.textContent = `${u.full_name || u.username} · ${u.role}`;
    const btn = document.createElement('button');
    btn.textContent = 'Log out';
    btn.style.cssText =
      'border:0;background:#1769d2;color:#fff;border-radius:999px;padding:6px 12px;cursor:pointer;font:inherit';
    btn.addEventListener('click', window.carepointLogout);
    chip.append(label, btn);
    document.body.appendChild(chip);
  }

  document.addEventListener('DOMContentLoaded', renderUserChip);
})();
