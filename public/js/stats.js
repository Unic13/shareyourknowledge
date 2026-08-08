// js/stats.js
const StatsModule = (() => {
  let session, loaded = false;

  function init(s) {
    session = s;
    if (loaded) return; // only fetch once per page load; add a refresh button if you want live reload
    loaded = true;
    render();
  }

  async function render() {
    const wrap = document.getElementById('stats-container');
    wrap.innerHTML = '<div class="empty-table"><div class="big">⏳</div><p>Loading statistics…</p></div>';
    const res = await Api.get('/api/data', { type: 'stats' });
    const rows = res.bySubject || [];

    if (!rows.length) {
      wrap.innerHTML = '<div class="empty-table"><div class="big">📭</div><p>No attempts recorded yet' +
        (Auth.isAdminOrAbove(session) ? '' : ' for your subjects') + '</p></div>';
      return;
    }

    const max = Math.max(...rows.map(r => r.attempts), 1);
    let html = '<div class="table-wrap" style="padding:20px">';
    rows.forEach(r => {
      html += `
        <div class="stat-bar-wrap" style="cursor:pointer" onclick="StatsModule.drill('${r.subject}')">
          <div class="stat-bar-label">
            <span><span class="badge badge-blue">${r.subject}</span> ${r.attempts} attempts · ${r.unique_learners ?? '—'} learners</span>
            <span style="font-weight:700">${r.accuracy}% correct</span>
          </div>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(r.attempts / max) * 100}%"></div></div>
        </div>`;
    });
    html += '<div class="b-field-hint" style="margin-top:6px">Click a subject to see its per-chapter breakdown.</div></div>';
    html += '<div id="stats-drill" style="margin-top:16px"></div>';
    wrap.innerHTML = html;
  }

  async function drill(subject) {
    const el = document.getElementById('stats-drill');
    el.innerHTML = '<div class="empty-table"><div class="big">⏳</div><p>Loading…</p></div>';
    const res = await Api.get('/api/data', { type: 'stats', subject });
    if (res.error) { el.innerHTML = `<div class="empty-table"><div class="big">⚠️</div><p>${res.error}</p></div>`; return; }

    const rows = res.byChapter || [];
    const max = Math.max(...rows.map(r => r.attempts), 1);
    let html = `<div class="table-wrap" style="padding:20px">
      <div style="font-weight:700;font-size:13px;margin-bottom:12px">${subject} — by chapter (${res.totals.attempts} total · ${res.totals.accuracy}% accuracy)</div>`;
    if (!rows.length) html += '<div class="b-field-hint">No chapter-level attempts yet.</div>';
    rows.forEach(r => {
      html += `
        <div class="stat-bar-wrap">
          <div class="stat-bar-label"><span>${r.chapter_title}</span><span style="font-weight:700">${r.accuracy}% (${r.attempts})</span></div>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(r.attempts / max) * 100}%"></div></div>
        </div>`;
    });
    html += '</div>';
    el.innerHTML = html;
  }

  return { init, drill };
})();
