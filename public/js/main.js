// js/main.js
let session = null;

document.addEventListener('DOMContentLoaded', () => {
  session = Auth.requireAuth();
  if (!session) return;

  document.getElementById('user-name').textContent = session.user.name;
  const roleBadge = document.getElementById('role-badge');
  roleBadge.textContent = session.user.role.replace('_', ' ');
  roleBadge.className = 'role-badge role-' + session.user.role;

  document.getElementById('btn-logout').onclick = Auth.logout;

  // Editors get a read-only "My Profile" version of this tab instead of
  // full team management.
  document.getElementById('sec-tab-users').textContent = Auth.isAdminOrAbove(session) ? '👥 Team & Access' : '👤 My Profile';

  loadTopStats();
  switchSection('builder'); // builder is the most common landing spot
  DataModule.init(session);
  BuilderModule.init(session);
  UsersModule.init(session);
});

async function loadTopStats() {
  const stats = await Api.get('/api/data', { type: 'stats' });
  const rows = stats.bySubject || [];
  const totalAttempts = rows.reduce((a, r) => a + r.attempts, 0);
  const totalCorrect = rows.reduce((a, r) => a + r.correct, 0);
  document.getElementById('stat-attempts').textContent = totalAttempts;
  document.getElementById('stat-accuracy').textContent = totalAttempts ? Math.round(totalCorrect / totalAttempts * 100) + '%' : '—';
  document.getElementById('stat-subjects').textContent = rows.length || (Auth.allowedCodes(session) || []).length || '—';

  if (Auth.isAdminOrAbove(session)) {
    const reg = await Api.get('/api/data', { type: 'registrations' });
    document.getElementById('stat-regs').textContent = reg.count ?? '—';
  } else {
    document.getElementById('stat-regs').closest('.stat-card').style.display = 'none';
  }
}

function switchSection(name) {
  ['builder', 'data', 'stats', 'feedback', 'users'].forEach(s => {
    const tab = document.getElementById('sec-tab-' + s);
    const panel = document.getElementById('section-' + s);
    if (!tab || !panel) return;
    tab.classList.toggle('active', s === name);
    panel.classList.toggle('active', s === name);
  });
  if (name === 'stats') StatsModule.init(session);
  if (name === 'feedback') FeedbackModule.init(session);
}
