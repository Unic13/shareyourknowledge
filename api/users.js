// api/users.js
// Vercel serverless function — merges what would otherwise be three
// separate routes (login, admin_users CRUD, admin_subjects mapping) into
// one file to keep the function count down.
//
// No bcrypt (not installed) — passwords are compared as plain text against
// admin_users.password_hash. No JWT — the browser keeps a plain session
// object in localStorage after login and sends `requesterId` back on every
// write; this file re-checks that id's role/active status against Hasura
// on every call, so a forged/edited localStorage value just gets a
// 401/403, it can't grant real access.
//
// ── Users ──────────────────────────────────────────────────────────────
// POST   /api/users              { action:'login', email, password }        → public
// GET    /api/users              ?requesterId=1                             → list (editor: self only)
// POST   /api/users              { requesterId, name, email, password, role } → create
// PUT    /api/users              { requesterId, id, name, email, password?, role, active } → update
// DELETE /api/users              { requesterId, id }                        → delete
//
// ── Editor ↔ Subject mapping ──────────────────────────────────────────
// GET    /api/users?resource=mappings   ?requesterId=1&adminId=5            → list mappings
// POST   /api/users                     { requesterId, resource:'mapping', adminId, subjectId, canEdit, canPublish }
// DELETE /api/users                     { requesterId, resource:'mapping', id }
const { hasuraRequest } = require('../lib/hasura');

const GET_USER_BY_EMAIL = `
  query GetUserByEmail($email: String!) {
    admin_users(where: { email: { _eq: $email } }, limit: 1) {
      id name email password_hash role active
    }
  }
`;
const GET_USER_BY_ID = `
  query GetUserById($id: bigint!) {
    admin_users_by_pk(id: $id) { id name email role active }
  }
`;
const GET_ALL_USERS = `
  query GetAllUsers {
    admin_users(order_by: { created_at: desc }) {
      id name email role active created_at
    }
  }
`;
const GET_ALL_MAPPINGS_RAW = `
  query GetAllMappings {
    admin_subjects {
      id admin_id subject_id can_edit can_publish assigned_at
      subject: subject_content { code subject subject_title color }
      admin: admin_user { id name email }
    }
  }
`;
// Fallback query if the relationships above aren't tracked in your Hasura
// metadata under those names — resolves the same data with plain joins done
// in JS instead of relying on named relationships.
const GET_ALL_MAPPINGS_FLAT = `
  query GetAllMappingsFlat {
    admin_subjects { id admin_id subject_id can_edit can_publish variant_title assigned_at }
    subject_content { id code subject subject_title color }
    admin_users { id name email }
  }
`;
const INSERT_USER = `
  mutation InsertUser($object: admin_users_insert_input!) {
    insert_admin_users_one(object: $object) { id name email role active created_at }
  }
`;
const UPDATE_USER = `
  mutation UpdateUser($id: bigint!, $set: admin_users_set_input!) {
    update_admin_users_by_pk(pk_columns: { id: $id }, _set: $set) { id name email role active }
  }
`;
const DELETE_USER = `
  mutation DeleteUser($id: bigint!) {
    delete_admin_users_by_pk(id: $id) { id }
  }
`;
const UPSERT_MAPPING = `
  mutation UpsertMapping($object: admin_subjects_insert_input!) {
    insert_admin_subjects_one(
      object: $object
      on_conflict: {
        constraint: admin_subjects_admin_id_subject_id_key
        update_columns: [can_edit, can_publish, variant_title]
      }
    ) { id admin_id subject_id can_edit can_publish variant_title }
  }
`;
const DELETE_MAPPING = `
  mutation DeleteMapping($id: bigint!) {
    delete_admin_subjects_by_pk(id: $id) { id }
  }
`;

async function getEditorScope(adminId) {
  const { admin_subjects } = await hasuraRequest(
    `query Scope($adminId: bigint!) {
       admin_subjects(where: { admin_id: { _eq: $adminId } }) {
         id subject_id can_edit can_publish variant_title
       }
     }`,
    { adminId }
  );
  if (!admin_subjects.length) return [];
  const { subject_content } = await hasuraRequest(
    `query Subjects($ids: [bigint!]) {
       subject_content(where: { id: { _in: $ids } }) { id code subject color }
     }`,
    { ids: admin_subjects.map((m) => m.subject_id) }
  );
  const byId = Object.fromEntries(subject_content.map((s) => [s.id, s]));
  return admin_subjects.map((m) => ({
    subject_id: m.subject_id,
    code: byId[m.subject_id]?.code,
    subject: byId[m.subject_id]?.subject,
    color: byId[m.subject_id]?.color,
    can_edit: m.can_edit,
    can_publish: m.can_publish,
    variant_title: m.subject_title,
  }));
}

async function getRequester(requesterId) {
  if (!requesterId) return null;
  const { admin_users_by_pk } = await hasuraRequest(GET_USER_BY_ID, { id: requesterId });
  return admin_users_by_pk && admin_users_by_pk.active ? admin_users_by_pk : null;
}
const isAdminOrAbove = (u) => !!u && (u.role === 'admin' || u.role === 'super_admin');
const isSuperAdmin = (u) => !!u && u.role === 'super_admin';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'GET' ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}));
    const resource = (req.query && req.query.resource) || body.resource || 'users';

    // ── Public login (no requesterId yet) ──
    if (req.method === 'POST' && body.action === 'login') {
      const { email, password } = body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      const { admin_users } = await hasuraRequest(GET_USER_BY_EMAIL, { email: String(email).trim().toLowerCase() });
      const user = admin_users[0];
      if (!user || !user.active || user.password_hash !== password) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const subjects = user.role === 'editor' ? await getEditorScope(user.id) : null;
      return res.status(200).json({
        success: true,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        subjects,
      });
    }

    // Every other action requires a known requesterId.
    const requesterId = req.method === 'GET' ? req.query.requesterId : body.requesterId;
    const requester = await getRequester(requesterId);
    if (!requester) return res.status(401).json({ error: 'Unauthorized' });

    // ── Mapping resource ──
    if (resource === 'mappings' || resource === 'mapping') {
      if (!isAdminOrAbove(requester)) return res.status(403).json({ error: 'Admin access required' });

      if (req.method === 'GET') {
        const adminId = req.query.adminId;
        let flat;
        try {
          flat = await hasuraRequest(GET_ALL_MAPPINGS_FLAT);
        } catch (e) {
          return res.status(500).json({ error: e.message });
        }
        const subjectsById = Object.fromEntries(flat.subject_content.map((s) => [s.id, s]));
        const usersById = Object.fromEntries(flat.admin_users.map((u) => [u.id, u]));
        let mappings = flat.admin_subjects.map((m) => ({
          id: m.id,
          admin_id: m.admin_id,
          admin_name: usersById[m.admin_id]?.name,
          admin_email: usersById[m.admin_id]?.email,
          subject_id: m.subject_id,
          code: subjectsById[m.subject_id]?.code,
          subject: subjectsById[m.subject_id]?.subject,
          color: subjectsById[m.subject_id]?.color,
          can_edit: m.can_edit,
          can_publish: m.can_publish,
          variant_title: m.subject_title,
        }));
        if (adminId) mappings = mappings.filter((m) => String(m.admin_id) === String(adminId));
        return res.status(200).json({ mappings });
      }

      if (req.method === 'POST') {
        const { adminId, subjectId, canEdit = true, canPublish = false, variantTitle } = body;
        if (!adminId || !subjectId) return res.status(400).json({ error: 'adminId and subjectId required' });
        const result = await hasuraRequest(UPSERT_MAPPING, {
          object: { admin_id: adminId, subject_id: subjectId, can_edit: !!canEdit, can_publish: !!canPublish, variant_title: variantTitle || null },
        });
        return res.status(200).json({ success: true, mapping: result.insert_admin_subjects_one });
      }

      if (req.method === 'DELETE') {
        const { id } = body;
        if (!id) return res.status(400).json({ error: 'id required' });
        await hasuraRequest(DELETE_MAPPING, { id });
        return res.status(200).json({ success: true });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── Users resource ──
    if (req.method === 'GET') {
      if (requester.role === 'editor') {
        const subjects = await getEditorScope(requester.id);
        return res.status(200).json({ users: [requester], subjects });
      }
      const { admin_users } = await hasuraRequest(GET_ALL_USERS);
      // attach each user's mapped subjects for the table view
      const enriched = await Promise.all(
        admin_users.map(async (u) => ({ ...u, subjects: u.role === 'editor' ? await getEditorScope(u.id) : [] }))
      );
      return res.status(200).json({ users: enriched });
    }

    if (!isAdminOrAbove(requester)) return res.status(403).json({ error: 'Admin access required' });

    if (req.method === 'POST') {
      const { name, email, password, role } = body;
      if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' });
      if ((role === 'admin' || role === 'super_admin') && !isSuperAdmin(requester)) {
        return res.status(403).json({ error: 'Only a super_admin can create admin/super_admin accounts' });
      }
      const existing = await hasuraRequest(GET_USER_BY_EMAIL, { email: email.trim().toLowerCase() });
      if (existing.admin_users.length) return res.status(409).json({ error: 'Email already in use' });

      const result = await hasuraRequest(INSERT_USER, {
        object: { name: name.trim(), email: email.trim().toLowerCase(), password_hash: password, role },
      });
      return res.status(200).json({ success: true, user: result.insert_admin_users_one });
    }

    if (req.method === 'PUT') {
      const { id, name, email, password, role, active } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const targetRes = await hasuraRequest(`query T($id: bigint!) { admin_users_by_pk(id: $id) { role } }`, { id });
      const target = targetRes.admin_users_by_pk;
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (!isSuperAdmin(requester)) {
        if (target.role !== 'editor' || role === 'admin' || role === 'super_admin') {
          return res.status(403).json({ error: 'Only a super_admin can manage admin/super_admin accounts' });
        }
      }
      const set = {};
      if (name) set.name = name.trim();
      if (email) set.email = email.trim().toLowerCase();
      if (role) set.role = role;
      if (typeof active === 'boolean') set.active = active;
      if (password) set.password_hash = password; // plain text, see file header note
      if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to update' });

      const result = await hasuraRequest(UPDATE_USER, { id, set });
      return res.status(200).json({ success: true, user: result.update_admin_users_by_pk });
    }

    if (req.method === 'DELETE') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (String(id) === String(requester.id)) return res.status(400).json({ error: "You can't delete your own account" });
      const targetRes = await hasuraRequest(`query T($id: bigint!) { admin_users_by_pk(id: $id) { role } }`, { id });
      if (!targetRes.admin_users_by_pk) return res.status(404).json({ error: 'User not found' });
      if (targetRes.admin_users_by_pk.role !== 'editor' && !isSuperAdmin(requester)) {
        return res.status(403).json({ error: 'Only a super_admin can delete admin/super_admin accounts' });
      }
      await hasuraRequest(DELETE_USER, { id });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[USERS ERROR]', err.message);
    if (err.message.includes('not configured')) return res.status(200).json({ error: err.message, configured: false });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
