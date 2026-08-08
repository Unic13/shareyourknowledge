// js/users.js
const UsersModule = (() => {
  let session, users = [], allSubjects = [];

  function init(s) {
    session = s;
    if (Auth.isAdminOrAbove(session)) renderAdminView();
    else renderProfileView();
  }

  // ── Editor: read-only profile + their mapped subjects ──
  function renderProfileView() {
    const wrap = document.getElementById('section-users');
    const subs = session.subjects || [];
    wrap.innerHTML = `
      <div class="builder-col">
        <div class="builder-col-header"><span class="builder-col-title">My Profile</span></div>
        <div style="padding:18px">
          <div class="b-field"><label>Name</label><input type="text" value="${esc(session.user.name)}" disabled></div>
          <div class="b-field"><label>Email</label><input type="text" value="${esc(session.user.email)}" disabled></div>
          <div class="b-field"><label>Role</label><input type="text" value="${esc(session.user.role)}" disabled></div>
        </div>
      </div>
      <div class="builder-col">
        <div class="builder-col-header"><span class="builder-col-title">My Assigned Subjects</span></div>
        <div style="padding:18px">
          ${subs.length ? subs.map(s => `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f3f4f6">
              <span class="badge badge-blue">${esc(s.code)}</span>
              <span style="flex:1;font-weight:600;font-size:13px">${esc(s.subject)}</span>
              <span class="badge ${s.can_edit ? 'badge-green' : 'badge-red'}">${s.can_edit ? 'Can edit' : 'View only'}</span>
              ${s.can_publish ? '<span class="badge badge-purple">Can publish</span>' : ''}
            </div>`).join('') : '<div class="b-field-hint">You have not been assigned to any subjects yet — ask an admin to map you to one.</div>'}
        </div>
      </div>`;
  }

  // ── Admin/super_admin: full team management ──
  async function renderAdminView() {
    const wrap = document.getElementById('section-users');
    wrap.innerHTML = `
      <div class="builder-col">
        <div class="builder-col-header">
          <span class="builder-col-title">Team Members</span>
          <button class="b-btn b-btn-primary b-btn-sm" onclick="UsersModule.openCreate()">+ New Team Member</button>
        </div>
        <div id="users-table" style="padding:10px"><div class="empty-table"><div class="big">⏳</div><p>Loading…</p></div></div>
      </div>`;

    const [uRes, subRes] = await Promise.all([
      Api.get('/api/users'),
      Api.get('/api/content'),
    ]);
    users = uRes.users || [];
    allSubjects = subRes.subjects || [];
    renderUsersTable();
  }

  function renderUsersTable() {
    const el = document.getElementById('users-table');
    if (!users.length) { el.innerHTML = '<div class="empty-table"><div class="big">👥</div><p>No team members yet</p></div>'; return; }
    let html = '<div class="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Subjects</th><th>Status</th><th></th></tr></thead><tbody>';
    users.forEach(u => {
      const roleClass = u.role === 'super_admin' ? 'badge-purple' : u.role === 'admin' ? 'badge-blue' : 'badge-green';
      const subs = (u.subjects || []).map(s => `<span class="badge badge-blue" style="margin:2px" title="${s.can_edit ? 'can edit' : 'view only'}${s.can_publish ? ', can publish' : ''}">${esc(s.code)}</span>`).join(' ') || '<span style="color:#9ca3af">—</span>';
      html += `<tr>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td><span class="badge ${roleClass}">${esc(u.role)}</span></td>
        <td>${subs}</td>
        <td>${u.active === false ? '<span class="badge badge-red">Inactive</span>' : '<span class="badge badge-green">Active</span>'}</td>
        <td style="white-space:nowrap">
          <button class="b-btn b-btn-outline b-btn-sm" onclick="UsersModule.openEdit(${u.id})">Edit</button>
          ${u.role === 'editor' ? `<button class="b-btn b-btn-outline b-btn-sm" onclick="UsersModule.openMap(${u.id})">Map subjects</button>` : ''}
          <button class="b-btn b-btn-danger b-btn-sm" onclick="UsersModule.remove(${u.id})">Delete</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
  }

  function openCreate() {
    const name = prompt('Full name:');
    if (!name) return;
    const email = prompt('Email:');
    if (!email) return;
    const password = prompt('Temporary password (min 8 characters):');
    if (!password || password.length < 8) { alert('Password must be at least 8 characters.'); return; }
    const roleOptions = Auth.isSuperAdmin(session) ? 'editor / admin / super_admin' : 'editor';
    let role = prompt(`Role (${roleOptions}):`, 'editor');
    if (!role) return;
    role = role.trim().toLowerCase();

    Api.post('/api/users', { name, email, password, role }).then(res => {
      if (res.success) { renderAdminView(); }
      else alert(res.error || 'Could not create user');
    });
  }

  function openEdit(id) {
    const u = users.find(x => x.id === id);
    if (!u) return;
    const name = prompt('Name:', u.name);
    if (name === null) return;
    const email = prompt('Email:', u.email);
    if (email === null) return;
    const active = confirm('Keep this account ACTIVE? (Cancel = deactivate)');
    const password = prompt('New password (leave blank to keep current):', '');

    Api.put('/api/users', { id, name, email, active, ...(password ? { password } : {}) }).then(res => {
      if (res.success) renderAdminView();
      else alert(res.error || 'Could not update user');
    });
  }

  function remove(id) {
    if (!confirm('Delete this team member? This cannot be undone.')) return;
    Api.del('/api/users', { id }).then(res => {
      if (res.success) renderAdminView();
      else alert(res.error || 'Could not delete user');
    });
  }

  function openMap(adminId) {
    const u = users.find(x => x.id === adminId);
    if (!u) return;
    const current = (u.subjects || []).map(s => s.code);
    const list = allSubjects.map((s, i) => `${i + 1}. ${s.subject} (${s.code})${current.includes(s.code) ? ' ✓ already mapped' : ''}`).join('\n');
    const pick = prompt(`Assign ${u.name} to which subject? Enter the code exactly:\n\n${list}`);
    if (!pick) return;
    const subject = allSubjects.find(s => s.code.toLowerCase() === pick.trim().toLowerCase());
    if (!subject) { alert('No subject with that code.'); return; }
    const canEdit = confirm('Allow this editor to EDIT content in this subject? (Cancel = view only)');
    const canPublish = confirm('Allow this editor to PUBLISH (save live) in this subject?');

    // subjectId lookup requires the numeric id — fetch via admin-subjects listing endpoint's join,
    // simplest path: ask the server to resolve by code through admin-subjects POST accepting subjectId.
    // We only have code+subject+color from content1, so resolve subjectId via a lightweight lookup call.
    // We only have code/subject/color from /api/content — find the subject's
    // numeric id via the fuller mapping listing (which joins subject_content),
    // or via a subject that's already mapped to *someone*. If it's genuinely
    // never been saved as a subject_content row, there's nothing to map yet.
    Api.get('/api/users', { resource: 'mappings' }).then(async (mapRes) => {
      let subjectId = (mapRes.mappings || []).find(m => m.code === subject.code)?.subject_id;
      if (!subjectId) {
        alert('That subject hasn\'t been saved to the database yet. Save it once from the Question Builder tab (so it exists in subject_content), then map it here.');
        return;
      }
      const res = await Api.post('/api/users', { resource: 'mapping', adminId, subjectId, canEdit, canPublish });
      if (res.success) renderAdminView();
      else alert(res.error || 'Could not map subject');
    });
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  return { init, openCreate, openEdit, remove, openMap };
})();
