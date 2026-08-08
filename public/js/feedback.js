// js/feedback.js
const FeedbackModule = (() => {
  let session, loaded = false;

  function init(s) {
    session = s;
    if (loaded) return;
    loaded = true;
    renderOverview();
  }

  function stars(rating) {
    const r = Math.round(rating);
    return '★'.repeat(r) + '☆'.repeat(5 - r);
  }

  async function renderOverview() {
    const wrap = document.getElementById('feedback-container');
    wrap.innerHTML = '<div class="empty-table"><div class="big">⏳</div><p>Loading feedback…</p></div>';
    const res = await Api.get('/api/feedback');
    if (res.error) { wrap.innerHTML = `<div class="empty-table"><div class="big">⚠️</div><p>${res.error}</p></div>`; return; }

    const d = res.data;
    if (!d.count) {
      wrap.innerHTML = '<div class="empty-table"><div class="big">💬</div><p>No feedback yet' +
        (Auth.isAdminOrAbove(session) ? '' : ' for your subjects') + '</p></div>';
      return;
    }

    let html = `
      <div class="stats-grid" style="margin-bottom:20px">
        <div class="stat-card"><div class="stat-icon">💬</div><div class="stat-value">${d.count}</div><div class="stat-label">Total Feedback</div></div>
        <div class="stat-card"><div class="stat-icon">⭐</div><div class="stat-value">${d.averageRating}</div><div class="stat-label">${stars(d.averageRating)}</div></div>
      </div>`;

    const bySubject = d.bySubject || [];
    if (bySubject.length) {
      const max = Math.max(...bySubject.map(s => s.count), 1);
      html += '<div class="table-wrap" style="padding:20px;margin-bottom:16px">';
      html += '<div style="font-weight:700;font-size:13px;margin-bottom:12px">By subject</div>';
      bySubject.forEach(s => {
        html += `
          <div class="stat-bar-wrap" style="cursor:pointer" onclick="FeedbackModule.drill('${s.subject}')">
            <div class="stat-bar-label">
              <span><span class="badge badge-blue">${esc(s.subject)}</span> ${s.count} response${s.count === 1 ? '' : 's'}</span>
              <span style="font-weight:700">${s.averageRating} ${stars(s.averageRating)}</span>
            </div>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(s.count / max) * 100}%"></div></div>
          </div>`;
      });
      html += '<div class="b-field-hint" style="margin-top:6px">Click a subject to see its recent messages.</div></div>';
    }

    html += `<div id="feedback-recent">${renderRecentList(d.recent, bySubject.length ? null : 'Recent feedback')}</div>`;
    wrap.innerHTML = html;
  }

  function renderRecentList(recent, title) {
    if (!recent || !recent.length) return '';
    let html = '<div class="table-wrap" style="padding:20px">';
    if (title) html += `<div style="font-weight:700;font-size:13px;margin-bottom:12px">${esc(title)}</div>`;
    recent.forEach(f => {
      html += `
        <div style="padding:12px 0;border-bottom:1px solid #f3f4f6">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            ${f.subject ? `<span class="badge badge-blue">${esc(f.subject)}</span>` : '<span class="badge" style="background:#f3f4f6;color:#9ca3af">general</span>'}
            <span style="color:#f59e0b;font-size:13px">${stars(f.rating)}</span>
            <span style="margin-left:auto;font-size:11px;color:#9ca3af">${new Date(f.created_at).toLocaleString()}</span>
          </div>
          ${f.message ? `<div style="font-size:12.5px;color:#374151">${esc(f.message)}</div>` : '<div style="font-size:12px;color:#9ca3af">(no written comment)</div>'}
        </div>`;
    });
    html += '</div>';
    return html;
  }

  async function drill(subject) {
    const el = document.getElementById('feedback-recent');
    el.innerHTML = '<div class="empty-table"><div class="big">⏳</div><p>Loading…</p></div>';
    const res = await Api.get('/api/feedback', { subject });
    if (res.error) { el.innerHTML = `<div class="empty-table"><div class="big">⚠️</div><p>${res.error}</p></div>`; return; }
    el.innerHTML = renderRecentList(res.data.recent, `${subject} — ${res.data.count} response${res.data.count === 1 ? '' : 's'}, avg ${res.data.averageRating} ${stars(res.data.averageRating)}`);
  }

  function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  return { init, drill };
})();
