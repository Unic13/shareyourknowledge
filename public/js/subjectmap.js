// js/subjectmap.js
// Always fetches fresh from /api/users?resource=mappings, so any mapping
// just created (or removed) in the Team & Access tab shows up here the
// next time this tab is opened — no separate sync step needed since
// there's nothing cached client-side between visits.
const SubjectMapModule = (() => {
  let session, mappings = [], search = '', sortKey = 'subject', sortDir = 1;

  function init(s) {
    session = s;
    if (!Auth.isAdminOrAbove(session)) {
      document.getElementById('subjectmap-container').innerHTML =
        '<div class="empty-table"><div class="big">🔒</div><p>Only admins and super admins can see the full subject map.</p></div>';
      return;
    }
    load();
  }

  async function load() {
    const wrap = document.getElementById('subjectmap-container');
    wrap.innerHTML = '<div class="empty-table"><div class="big">⏳</div><p>Loading…</p></div>';
    const res = await Api.get('/api/users', { resource: 'mappings' });
    mappings = res.mappings || [];
    render();
  }

  function sortBy(key) {
    if (sortKey === key) sortDir *= -1;
    else { sortKey = key; sortDir = 1; }
    render();
  }

  function render() {
    const wrap = document.getElementById('subjectmap-container');
    const q = search.trim().toLowerCase();
    const filtered = q
      ? mappings.filter(m =>
          (m.subject || '').toLowerCase().includes(q) ||
          (m.code || '').toLowerCase().includes(q) ||
          (m.variant_title || '').toLowerCase().includes(q) ||
          (m.admin_name || '').toLowerCase().includes(q) ||
          (m.admin_email || '').toLowerCase().includes(q))
      : mappings;

    const sorted = filtered.slice().sort((a, b) => {
      const av = (a[sortKey] ?? '').toString().toLowerCase();
      const bv = (b[sortKey] ?? '').toString().toLowerCase();
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });

    const arrow = (key) => sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
    const th = (key, label) => `<th style="cursor:pointer;user-select:none" onclick="SubjectMapModule.sortBy('${key}')">${label}${arrow(key)}</th>`;

    let html = `
      <div class="table-toolbar">
        <input type="text" class="search-input" placeholder="Search subject, code, sub-topic, or editor…" value="${esc(search)}" oninput="SubjectMapModule.setSearch(this.value)">
        <button class="export-btn" onclick="SubjectMapModule.refresh()">🔄 Refresh</button>
      </div>`;

    if (!sorted.length) {
      html += `<div class="empty-table"><div class="big">🗂️</div><p>${mappings.length ? 'No mappings match your search' : 'No subject mappings yet — assign one from Team & Access'}</p></div>`;
    } else {
      html += `<div class="table-scroll"><table><thead><tr>
        ${th('subject', 'Subject Name')}
        ${th('code', 'Code')}
        ${th('variant_title', 'Sub-topic')}
        ${th('admin_name', 'Mapped Editor')}
        <th>Access</th>
        ${th('assigned_at', 'Mapped')}
      </tr></thead><tbody>`;
      sorted.forEach(m => {
        html += `<tr>
          <td style="font-weight:600">${esc(m.subject)}</td>
          <td><span class="badge badge-blue">${esc(m.code)}</span></td>
          <td>${m.variant_title ? esc(m.variant_title) : '<span style="color:#c4c4c4">—</span>'}</td>
          <td>
            <div style="font-weight:600">${esc(m.admin_name || '—')}</div>
            <div style="font-size:11px;color:#9ca3af">${esc(m.admin_email || '')}</div>
          </td>
          <td style="white-space:nowrap">
            <span class="badge ${m.can_edit ? 'badge-green' : 'badge-red'}">${m.can_edit ? 'Can edit' : 'View only'}</span>
            ${m.can_publish ? '<span class="badge badge-purple">Publish</span>' : ''}
          </td>
          <td style="white-space:nowrap;color:#9ca3af;font-size:11.5px">${m.assigned_at ? formatIST(m.assigned_at) : '—'}</td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    }
    wrap.innerHTML = `<div class="table-wrap">${html}</div>`;
  }

  function setSearch(val) { search = val; render(); }
  function refresh() { load(); }

  function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  return { init, setSearch, refresh, sortBy };
})();
