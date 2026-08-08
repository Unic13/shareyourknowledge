// js/api.js
const Api = (() => {
  function requesterId() {
    const s = Auth.getSession();
    return s ? s.user.id : null;
  }

  async function get(url, params) {
    const q = new URLSearchParams({ requesterId: requesterId() || '', ...(params || {}) });
    const res = await fetch(`${url}?${q.toString()}`);
    return res.json();
  }

  async function send(url, method, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterId: requesterId(), ...(body || {}) }),
    });
    return res.json();
  }

  return {
    get,
    post: (url, body) => send(url, 'POST', body),
    put: (url, body) => send(url, 'PUT', body),
    del: (url, body) => send(url, 'DELETE', body),
  };
})();
