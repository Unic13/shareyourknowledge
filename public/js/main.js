// js/main.js
let session = null;

// Tab-wise lazy load: tracks which section tabs have already had their
// module's init() (and therefore its data fetch) run, so a tab's content
// loads the first time it's tapped — not upfront on page load — and
// re-opening a tab you've already visited doesn't keep re-fetching. Each
// module still has its own "🔄 Refresh" control for pulling fresh data.
const loadedSections = new Set();

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
  if (!Auth.isAdminOrAbove(session)) {
    document.getElementById('guide-link').style.display = 'none';
    document.getElementById('sec-tab-subjectmap').style.display = 'none';
  }
  loadTopStats();
  switchSection('builder'); // builder is the most common landing spot — its
  // data loads right away below; every other tab now loads only when tapped.
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

// Which module owns each tab's data-loading — used by switchSection() below
// to fire the right init() only the first time that tab is opened.
const SECTION_MODULES = {
  builder: () => BuilderModule,
  data: () => DataModule,
  stats: () => StatsModule,
  feedback: () => FeedbackModule,
  subjectmap: () => SubjectMapModule,
  users: () => UsersModule,
};

function switchSection(name) {
  ['builder', 'data', 'stats', 'feedback', 'subjectmap', 'users'].forEach(s => {
    const tab = document.getElementById('sec-tab-' + s);
    const panel = document.getElementById('section-' + s);
    if (!tab || !panel) return;
    tab.classList.toggle('active', s === name);
    panel.classList.toggle('active', s === name);
  });

  if (!loadedSections.has(name) && SECTION_MODULES[name]) {
    loadedSections.add(name);
    SECTION_MODULES[name]().init(session);
  }
}
