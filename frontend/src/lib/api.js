const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Double-submit CSRF token: the backend sets a csrf_token cookie and returns the
// matching value here; every state-changing request echoes it in a header.
let csrfToken = null;

async function getCsrfToken(refresh = false) {
  if (csrfToken && !refresh) return csrfToken;
  const res = await fetch(`${BASE_URL}/csrf-token`, { credentials: 'include' });
  if (!res.ok) throw new ApiError('Could not obtain CSRF token', res.status);
  csrfToken = (await res.json()).csrfToken;
  return csrfToken;
}

async function send(path, method, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-CSRF-Token'] = token;
  return fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function request(path, { method = 'GET', body } = {}) {
  const unsafe = method !== 'GET';
  let res = await send(path, method, body, unsafe ? await getCsrfToken() : null);
  // The CSRF cookie may have expired or been cleared - fetch a fresh token once.
  if (unsafe && res.status === 403) {
    const retry = await send(path, method, body, await getCsrfToken(true));
    if (retry.status !== 403) res = retry;
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.details);
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  setupTwoFactor: () => request('/auth/2fa/setup', { method: 'POST' }),
  confirmTwoFactorSetup: (code) => request('/auth/2fa/setup/confirm', { method: 'POST', body: { code } }),
  verifyTwoFactor: (code) => request('/auth/2fa/verify', { method: 'POST', body: { code } }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  regenerateBackupCodes: (code) => request('/auth/2fa/backup-codes/regenerate', { method: 'POST', body: { code } }),

  sso: {
    listProviders: () => request('/auth/sso/providers'),
    // Not a fetch - a real page navigation, since the browser itself has to
    // follow the redirect chain out to the identity provider and back.
    startUrl: (providerId) => `${BASE_URL}/auth/sso/${providerId}/start`,
  },

  admin: {
    listUsers: (search) =>
      request(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    createUser: (payload) => request('/admin/users', { method: 'POST', body: payload }),
    updateUser: (id, payload) => request(`/admin/users/${id}`, { method: 'PATCH', body: payload }),
    resetPassword: (id, temporaryPassword) =>
      request(`/admin/users/${id}/reset-password`, { method: 'POST', body: { temporaryPassword } }),
    resetTwoFactor: (id) => request(`/admin/users/${id}/reset-2fa`, { method: 'POST' }),
    auditLogs: () => request('/admin/audit-logs'),
  },
};
