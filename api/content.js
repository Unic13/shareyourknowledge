// api/content.js
// Vercel serverless function — reads/writes subject content (units → chapters
// → concept + questions + playground) for the Admin Question Builder.
//
// GET  /api/content?code=PH                                   → fetch one subject's JSON (public, no login needed)
// GET  /api/content                                            → fetch all subjects (list, public)
// POST /api/content                                            → upsert a subject's JSON
//      body: { code, subject, color, data, requesterId }         (preferred — role/mapping checked against admin_users)
//      body: { code, subject, color, data, key: ADMIN_KEY }       (legacy — still works as a super-admin bypass)
//
// No bcrypt/JWT anywhere in this project — auth is a plain admin_users row
// looked up by id, and the browser only ever holds a plain localStorage
// session object. See api/users.js for login.
const { hasuraRequest } = require('../lib/hasura');
const ADMIN_KEY = process.env.ADMIN_KEY; // optional legacy bypass, safe to leave unset

const GET_ONE = `
  query GetSubjectContent($code: String!) {
    subject_content(where: { code: { _eq: $code } }, limit: 1) {
      id
      code
      subject
      color
      data
      updated_at
    }
  }
`;
const GET_ALL = `
  query GetAllSubjectContent {
    subject_content(order_by: { code: asc }) {
      id
      code
      subject
      color
      updated_at
    }
  }
`;
const UPSERT = `
  mutation UpsertSubjectContent($object: subject_content_insert_input!) {
    insert_subject_content_one(
      object: $object
      on_conflict: {
        constraint: subject_content_code_key
        update_columns: [subject, color, data, updated_by, updated_at]
      }
    ) {
      id
      code
      updated_at
    }
  }
`;
const GET_USER = `
  query GetUser($id: bigint!) {
    admin_users_by_pk(id: $id) { id name email role active }
  }
`;
const CHECK_MAPPING = `
  query CheckMapping($adminId: bigint!, $subjectId: bigint!) {
    admin_subjects(where: { admin_id: { _eq: $adminId }, subject_id: { _eq: $subjectId } }) {
      can_edit
      can_publish
    }
  }
`;
const INSERT_LOG = `
  mutation InsertLog($object: subject_update_logs_insert_input!) {
    insert_subject_update_logs_one(object: $object) { id }
  }
`;

// Returns { ok: true, requesterId } or { ok: false, status, error }
async function checkWritePermission(body, existingSubjectId) {
  const key = body && body.key;
  if (ADMIN_KEY && key === ADMIN_KEY) {
    return { ok: true, requesterId: null }; // legacy bypass, no audit "by" attribution
  }

  const requesterId = body && body.requesterId;
  if (!requesterId) return { ok: false, status: 401, error: 'Unauthorized' };

  const { admin_users_by_pk: user } = await hasuraRequest(GET_USER, { id: requesterId });
  if (!user || !user.active) return { ok: false, status: 401, error: 'Unauthorized' };

  if (user.role === 'admin' || user.role === 'super_admin') {
    return { ok: true, requesterId };
  }

  // editor: must have an explicit can_edit mapping on this exact subject
  if (!existingSubjectId) {
    // brand-new subject (never saved before) — editors can't create subjects,
    // only admins/super_admins can; ask them to have one set it up first.
    return { ok: false, status: 403, error: 'Only an admin can create a brand-new subject' };
  }
  const { admin_subjects: mappings } = await hasuraRequest(CHECK_MAPPING, {
    adminId: requesterId,
    subjectId: existingSubjectId,
  });
  const mapping = mappings[0];
  if (!mapping || !mapping.can_edit) {
    return { ok: false, status: 403, error: 'You do not have edit access to this subject' };
  }
  return { ok: true, requesterId };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    try {
      const { code, subject, color, data } = body || {};
      if (!code || !subject || !data) {
        return res.status(400).json({ error: 'code, subject, and data are required' });
      }
      if (!data.units || !Array.isArray(data.units)) {
        return res.status(400).json({ error: 'data.units must be an array' });
      }

      const upperCode = code.toUpperCase();
      const existing = await hasuraRequest(GET_ONE, { code: upperCode });
      const existingRow = existing.subject_content[0] || null;

      const perm = await checkWritePermission(body, existingRow ? existingRow.id : null);
      if (!perm.ok) return res.status(perm.status).json({ error: perm.error });

      const result = await hasuraRequest(UPSERT, {
        object: {
          code: upperCode,
          subject,
          color: color || '#6C3FF5',
          data,
          updated_by: perm.requesterId || null,
          created_by: existingRow ? undefined : perm.requesterId || null,
          updated_at: new Date().toISOString(),
        },
      });

      const savedId = result.insert_subject_content_one.id;
      const action = existingRow ? 'UPDATE' : 'CREATE';
      try {
        await hasuraRequest(INSERT_LOG, {
          object: {
            subject_id: savedId,
            admin_id: perm.requesterId || null,
            action,
            message: `${action === 'CREATE' ? 'Created' : 'Updated'} "${subject}" (${upperCode})`,
            old_data: existingRow ? existingRow.data : null,
            new_data: data,
          },
        });
      } catch (logErr) {
        // Never let a logging failure block the actual save.
        console.error('[CONTENT AUDIT LOG ERROR]', logErr.message);
      }

      return res.status(200).json({ success: true, code: result.insert_subject_content_one.code });
    } catch (err) {
      console.error('[CONTENT ERROR]', err.message);
      if (err.message.includes('not configured')) {
        return res.status(200).json({ error: err.message, configured: false });
      }
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  if (req.method === 'GET') {
    try {
      const code = req.query?.code;
      if (code) {
        const data = await hasuraRequest(GET_ONE, { code: code.toUpperCase() });
        const row = data.subject_content[0] || null;
        if (!row) return res.status(404).json({ error: 'Subject not found' });
        return res.status(200).json(row);
      }
      const data = await hasuraRequest(GET_ALL);
      return res.status(200).json({ subjects: data.subject_content });
    } catch (err) {
      console.error('[CONTENT ERROR]', err.message);
      // Soft-fail so the frontend can fall back to the static JSON file
      return res.status(200).json({ error: err.message, configured: false });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
