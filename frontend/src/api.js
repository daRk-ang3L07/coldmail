// Thin fetch wrapper. All requests are same-origin (Vite proxies API prefixes
// to the backend in dev), so the session cookie rides along automatically.

async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),

  // File upload (multipart) — separate because it isn't JSON.
  upload: async (path, file) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(path, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${res.status}`);
    return data;
  },
};

// Connecting Gmail requires a full-page redirect (OAuth), not fetch.
export const CONNECT_URL = '/auth/google';
