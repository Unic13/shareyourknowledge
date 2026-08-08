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

// Formats any timestamp as Indian time (Asia/Kolkata), down to the second —
// no milliseconds/microseconds, no raw UTC "Z" strings in the UI.
// e.g. "08 Aug 2026, 02:34:10 pm"
function formatIST(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).replace(',', ',');
}
function isTimestampKey(key) {
  return /(_at|At)$/.test(key);
}
