// js/users.js
const UsersModule = (() => {
  let session, users = [], allSubjects = [], userSearch = '';
  let editingUserId = null, mappingAdminId = null;

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
        <div style="padding:14px 16px 0">
          <input type="text" id="user-search-input" class="search-input" placeholder="Search by name, email, or role…" oninput="UsersModule.setSearch(this.value)">
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

  function setSearch(val) {
    userSearch = val.trim().toLowerCase();
    renderUsersTable();
  }

  function renderUsersTable() {
    const el = document.getElementById('users-table');
    const filtered = userSearch
      ? users.filter(u => (u.name || '').toLowerCase().includes(userSearch) || (u.email || '').toLowerCase().includes(userSearch) || (u.role || '').toLowerCase().includes(userSearch))
      : users;

    if (!filtered.length) {
      el.innerHTML = `<div class="empty-table"><div class="big">👥</div><p>${userSearch ? 'No team members match your search' : 'No team members yet'}</p></div>`;
      return;
    }
    let html = '<div class="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Subjects</th><th>Status</th><th></th></tr></thead><tbody>';
    filtered.forEach(u => {
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
          ${u.role === 'editor' ? `<button class="b-btn b-btn-outline b-btn-sm" onclick="UsersModule.openMapModal(${u.id})">Map subjects</button>` : ''}
          <button class="b-btn b-btn-danger b-btn-sm" onclick="UsersModule.remove(${u.id})">Delete</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
  }

  // ── Create / Edit user modal ──
  function openCreate() {
    editingUserId = null;
    document.getElementById('user-modal-title').textContent = 'New Team Member';
    document.getElementById('um-name').value = '';
    document.getElementById('um-email').value = '';
    document.getElementById('um-password').value = '';
    document.getElementById('um-password-label').textContent = 'Password';
    document.getElementById('um-password').placeholder = '';
    document.getElementById('um-role').value = 'editor';
    document.getElementById('um-active-field').style.display = 'none';
    document.getElementById('um-err').textContent = '';
    document.getElementById('um-submit-btn').textContent = 'Create';
    const roleSelect = document.getElementById('um-role');
    roleSelect.querySelectorAll('option').forEach(o => { o.disabled = !Auth.isSuperAdmin(session) && o.value !== 'editor'; });
    document.getElementById('user-modal-overlay').classList.add('open');
  }

  function openEdit(id) {
    const u = users.find(x => x.id === id);
    if (!u) return;
    editingUserId = id;
    document.getElementById('user-modal-title').textContent = 'Edit Team Member';
    document.getElementById('um-name').value = u.name;
    document.getElementById('um-email').value = u.email;
    document.getElementById('um-password').value = '';
    document.getElementById('um-password-label').textContent = 'New Password';
    document.getElementById('um-password').placeholder = 'Leave blank to keep current password';
    document.getElementById('um-role').value = u.role;
    document.getElementById('um-active-field').style.display = '';
    document.getElementById('um-active').checked = u.active !== false;
    document.getElementById('um-err').textContent = '';
    document.getElementById('um-submit-btn').textContent = 'Save Changes';
    const roleSelect = document.getElementById('um-role');
    roleSelect.querySelectorAll('option').forEach(o => { o.disabled = !Auth.isSuperAdmin(session) && o.value !== 'editor' && o.value !== u.role; });
    document.getElementById('user-modal-overlay').classList.add('open');
  }

  function closeModal() { document.getElementById('user-modal-overlay').classList.remove('open'); }

  async function submitModal() {
    const errEl = document.getElementById('um-err');
    errEl.textContent = '';
    const name = document.getElementById('um-name').value.trim();
    const email = document.getElementById('um-email').value.trim();
    const password = document.getElementById('um-password').value;
    const role = document.getElementById('um-role').value;
    const btn = document.getElementById('um-submit-btn');

    if (!name || !email) { errEl.textContent = 'Name and email are required.'; return; }
    if (!editingUserId && (!password || password.length < 6)) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

    btn.disabled = true;
    let res;
    if (editingUserId) {
      const active = document.getElementById('um-active').checked;
      res = await Api.put('/api/users', { id: editingUserId, name, email, role, active, ...(password ? { password } : {}) });
    } else {
      res = await Api.post('/api/users', { name, email, password, role });
    }
    btn.disabled = false;

    if (res.success) { closeModal(); renderAdminView(); }
    else errEl.textContent = res.error || 'Something went wrong — please try again.';
  }

  function remove(id) {
    if (!confirm('Delete this team member? This cannot be undone.')) return;
    Api.del('/api/users', { id }).then(res => {
      if (res.success) renderAdminView();
      else document.getElementById('users-table').insertAdjacentHTML('afterbegin', `<div class="errmsg" style="margin-bottom:8px">${esc(res.error || 'Could not delete user')}</div>`);
    });
  }

  // ── Map Subject modal (create/update/delete) ──
  async function openMapModal(adminId) {
    const u = users.find(x => x.id === adminId);
    if (!u) return;
    mappingAdminId = adminId;
    document.getElementById('map-modal-title').textContent = `Map Subjects — ${u.name}`;
    document.getElementById('mm-err').textContent = '';
    document.getElementById('mm-edit').checked = true;
    document.getElementById('mm-publish').checked = false;

    const body = document.querySelector('#map-modal-overlay .form-modal-body');
    let existingBlock = document.getElementById('mm-existing');
    if (!existingBlock) {
      existingBlock = document.createElement('div');
      existingBlock.id = 'mm-existing';
      body.insertBefore(existingBlock, body.firstChild);
    }
    existingBlock.innerHTML = '<div class="b-field-hint">Loading current mappings…</div>';
    document.getElementById('map-modal-overlay').classList.add('open');

    const mapRes = await Api.get('/api/users', { resource: 'mappings', adminId });
    const mappings = mapRes.mappings || [];

    const select = document.getElementById('mm-subject');
    select.innerHTML = allSubjects.length
      ? allSubjects.map(s => `<option value="${s.code}">${esc(s.subject)} (${s.code})${mappings.find(m => m.code === s.code) ? ' — already mapped' : ''}</option>`).join('')
      : '<option value="">No subjects exist yet — save one from the Question Builder first</option>';

    existingBlock.innerHTML = mappings.length
      ? '<div class="b-field-hint" style="margin-bottom:6px">Currently mapped:</div>' +
        mappings.map(m => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f6">
            <span class="badge badge-blue">${esc(m.code)}</span>
            <span style="flex:1;font-size:12.5px">${esc(m.subject)}</span>
            <span class="badge ${m.can_edit ? 'badge-green' : 'badge-red'}">${m.can_edit ? 'edit' : 'view'}</span>
            <button class="b-btn b-btn-danger b-btn-sm" onclick="UsersModule.removeMapping(${m.id})">Remove</button>
          </div>`).join('') + '<div class="b-field-hint" style="margin:10px 0 4px">Add another:</div>'
      : '';
  }

  function closeMapModal() {
    document.getElementById('map-modal-overlay').classList.remove('open');
    const existingBlock = document.getElementById('mm-existing');
    if (existingBlock) existingBlock.innerHTML = '';
  }

  async function submitMapModal() {
    const errEl = document.getElementById('mm-err');
    errEl.textContent = '';
    const code = document.getElementById('mm-subject').value;
    if (!code) { errEl.textContent = 'Pick a subject.'; return; }
    const subject = allSubjects.find(s => s.code === code);
    if (!subject || !subject.id) { errEl.textContent = 'Could not resolve that subject — try reopening this dialog.'; return; }

    const canEdit = document.getElementById('mm-edit').checked;
    const canPublish = document.getElementById('mm-publish').checked;
    const res = await Api.post('/api/users', { resource: 'mapping', adminId: mappingAdminId, subjectId: subject.id, canEdit, canPublish });
    if (res.success) { closeMapModal(); renderAdminView(); }
    else errEl.textContent = res.error || 'Could not save mapping.';
  }

  async function removeMapping(mappingId) {
    if (!mappingId) return;
    if (!confirm('Remove this subject mapping?')) return;
    const res = await Api.del('/api/users', { resource: 'mapping', id: mappingId });
    if (res.success) { closeMapModal(); renderAdminView(); }
    else document.getElementById('mm-err').textContent = res.error || 'Could not remove mapping.';
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  return { init, openCreate, openEdit, closeModal, submitModal, remove, setSearch, openMapModal, closeMapModal, submitMapModal, removeMapping };
})();
