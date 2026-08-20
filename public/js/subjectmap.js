// js/subjectmap.js
// Always fetches fresh from /api/users?resource=mappings AND /api/content,
// so any mapping just created (or removed) in the Team & Access tab, or any
// subject created in the Question Builder tab, shows up here the next time
// this tab is opened — no separate sync step needed since there's nothing
// cached client-side between visits.
const SubjectMapModule = (() => {
  let session, mappings = [], search = '', sortKey = 'subject', sortDir = 1, statusFilter = 'all';

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

    const [mapRes, contentRes] = await Promise.all([
      Api.get('/api/users', { resource: 'mappings' }),
      Api.get('/api/content'),
    ]);

    const mapped = (mapRes.mappings || []).map(m => ({ ...m, _unmapped: false }));
    const allSubjects = contentRes.subjects || [];
    const mappedCodes = new Set(mapped.map(m => m.code));

    // Any subject that exists in the content builder but has no row in the
    // mappings table yet — surfaced here so admins can see, at a glance,
    // which subjects still need an editor assigned from Team & Access.
    const unmapped = allSubjects
      .filter(s => !mappedCodes.has(s.code))
      .map(s => ({
        subject: s.subject,
        code: s.code,
        variant_title: s.subject_title || '',
        admin_name: '',
        admin_email: '',
        can_edit: false,
        can_publish: false,
        assigned_at: null,
        _unmapped: true,
      }));

    mappings = mapped.concat(unmapped);
    render();
  }

  function sortBy(key) {
    if (sortKey === key) sortDir *= -1;
    else { sortKey = key; sortDir = 1; }
    render();
  }

  function setStatusFilter(val) {
    statusFilter = val;
    render();
  }

  function render() {
    const wrap = document.getElementById('subjectmap-container');
    const q = search.trim().toLowerCase();

    let filtered = statusFilter === 'mapped' ? mappings.filter(m => !m._unmapped)
      : statusFilter === 'unmapped' ? mappings.filter(m => m._unmapped)
      : mappings;

    filtered = q
      ? filtered.filter(m =>
          (m.subject || '').toLowerCase().includes(q) ||
          (m.code || '').toLowerCase().includes(q) ||
          (m.variant_title || '').toLowerCase().includes(q) ||
          (m.admin_name || '').toLowerCase().includes(q) ||
          (m.admin_email || '').toLowerCase().includes(q))
      : filtered;

    const sorted = filtered.slice().sort((a, b) => {
      const av = (a[sortKey] ?? '').toString().toLowerCase();
      const bv = (b[sortKey] ?? '').toString().toLowerCase();
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });

    const arrow = (key) => sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
    const th = (key, label) => `<th style="cursor:pointer;user-select:none" onclick="SubjectMapModule.sortBy('${key}')">${label}${arrow(key)}</th>`;

    const unmappedCount = mappings.filter(m => m._unmapped).length;
    const mappedCount = mappings.length - unmappedCount;

    const filterBtn = (val, label, count) => `<button class="export-btn${statusFilter === val ? ' active' : ''}" style="${statusFilter === val ? 'background:#374151;color:#fff' : ''}" onclick="SubjectMapModule.setStatusFilter('${val}')">${label} (${count})</button>`;

    let html = `
      <div class="table-toolbar" style="flex-wrap:wrap;gap:8px">
        <input type="text" class="search-input" placeholder="Search subject, code, sub-topic, or editor…" value="${esc(search)}" oninput="SubjectMapModule.setSearch(this.value)">
        <div style="display:flex;gap:6px">
          ${filterBtn('all', 'All', mappings.length)}
          ${filterBtn('mapped', 'Mapped', mappedCount)}
          ${filterBtn('unmapped', 'Unmapped', unmappedCount)}
        </div>
        <button class="export-btn" onclick="SubjectMapModule.refresh()">🔄 Refresh</button>
      </div>`;

    if (!sorted.length) {
      const emptyMsg = !mappings.length ? 'No subjects yet — create one from the Question Builder tab'
        : q ? 'No mappings match your search'
        : statusFilter === 'unmapped' ? 'Every subject has an editor mapped 🎉'
        : statusFilter === 'mapped' ? 'No subjects have been mapped yet'
        : 'No mappings match your search';
      html += `<div class="empty-table"><div class="big">🗂️</div><p>${emptyMsg}</p></div>`;
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
        html += `<tr${m._unmapped ? ' style="background:#fef2f2"' : ''}>
          <td style="font-weight:600">${esc(m.subject)}</td>
          <td><span class="badge badge-blue">${esc(m.code)}</span></td>
          <td>${m.variant_title ? esc(m.variant_title) : '<span style="color:#c4c4c4">—</span>'}</td>
          <td>
            ${m._unmapped
              ? '<div style="font-style:italic;color:#b91c1c">— Not assigned —</div>'
              : `<div style="font-weight:600">${esc(m.admin_name || '—')}</div>
                 <div style="font-size:11px;color:#9ca3af">${esc(m.admin_email || '')}</div>`}
          </td>
          <td style="white-space:nowrap">
            ${m._unmapped
              ? '<span class="badge badge-red">Unmapped</span>'
              : `<span class="badge ${m.can_edit ? 'badge-green' : 'badge-red'}">${m.can_edit ? 'Can edit' : 'View only'}</span>
                 ${m.can_publish ? '<span class="badge badge-purple">Publish</span>' : ''}`}
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

  return { init, setSearch, refresh, sortBy, setStatusFilter };
})();
