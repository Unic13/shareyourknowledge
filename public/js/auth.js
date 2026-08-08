// js/auth.js
// Plain localStorage session — no JWT. The server still re-checks the
// requesterId's role/active status on every write, so a stale or edited
// localStorage value can't grant access it doesn't actually have; it can
// only get you a 401/403 from the API.
const Auth = (() => {
  const KEY = 'unic_admin_session';

  function getSession() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setSession(user, subjects) {
    localStorage.setItem(KEY, JSON.stringify({ user, subjects: subjects || null, ts: Date.now() }));
  }

  function clearSession() {
    localStorage.removeItem(KEY);
  }

  function requireAuth() {
    const s = getSession();
    if (!s) { location.href = 'login.html'; return null; }
    return s;
  }

  function isAdminOrAbove(session) {
    return !!session && (session.user.role === 'admin' || session.user.role === 'super_admin');
  }
  function isSuperAdmin(session) {
    return !!session && session.user.role === 'super_admin';
  }

  // Subject codes this user may see/edit. null = unrestricted (admin/super_admin).
  function allowedCodes(session) {
    if (!session) return [];
    if (session.user.role !== 'editor') return null;
    return (session.subjects || []).map(s => s.code);
  }

  function canEditSubject(session, code) {
    if (!session) return false;
    if (session.user.role !== 'editor') return true;
    const m = (session.subjects || []).find(s => s.code === code);
    return !!(m && m.can_edit);
  }

  function logout() {
    clearSession();
    location.href = 'login.html';
  }

  return { getSession, setSession, clearSession, requireAuth, isAdminOrAbove, isSuperAdmin, allowedCodes, canEditSubject, logout };
})();
