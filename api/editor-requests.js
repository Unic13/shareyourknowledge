// api/editor-requests.js
// POST { name, email, phone, subjectsInterested, message }        → public, anyone can request to become an editor
// GET  ?requesterId=1&status=pending                                → admin/super_admin: list requests
// PUT  { requesterId, id, status }                                    → admin/super_admin: approve/reject
const { hasuraRequest } = require('../lib/hasura');

const INSERT_REQUEST = `
  mutation InsertRequest($object: editor_requests_insert_input!) {
    insert_editor_requests_one(object: $object) { id }
  }
`;
const GET_REQUESTS = `
  query GetRequests($where: editor_requests_bool_exp!) {
    editor_requests(where: $where, order_by: { created_at: desc }) {
      id name email phone subjects_interested message status created_at
    }
  }
`;
const UPDATE_STATUS = `
  mutation UpdateStatus($id: bigint!, $status: String!, $reviewedBy: bigint) {
    update_editor_requests_by_pk(pk_columns: { id: $id }, _set: { status: $status, reviewed_by: $reviewedBy }) {
      id status
    }
  }
`;
const GET_USER = `
  query GetUser($id: bigint!) { admin_users_by_pk(id: $id) { id role active } }
`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { name, email, phone, subjectsInterested, message } = body;
      if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid name and email are required' });
      }
      const result = await hasuraRequest(INSERT_REQUEST, {
        object: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone || null,
          subjects_interested: subjectsInterested || null,
          message: (message || '').slice(0, 2000),
          status: 'pending',
        },
      });
      return res.status(200).json({ success: true, id: result.insert_editor_requests_one.id });
    }

    // Everything past here is admin/super_admin only.
    const requesterId = req.method === 'GET' ? req.query.requesterId : (typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}).requesterId;
    const { admin_users_by_pk: requester } = await hasuraRequest(GET_USER, { id: requesterId });
    if (!requester || !requester.active) return res.status(401).json({ error: 'Unauthorized' });
    if (requester.role !== 'admin' && requester.role !== 'super_admin') return res.status(403).json({ error: 'Admin access required' });

    if (req.method === 'GET') {
      const status = (req.query.status || '').toString().trim();
      const where = status ? { status: { _eq: status } } : {};
      const { editor_requests } = await hasuraRequest(GET_REQUESTS, { where });
      return res.status(200).json({ success: true, requests: editor_requests });
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { id, status } = body;
      if (!id || !['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'id and a valid status are required' });
      }
      const result = await hasuraRequest(UPDATE_STATUS, { id, status, reviewedBy: requesterId });
      return res.status(200).json({ success: true, data: result.update_editor_requests_by_pk });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[EDITOR-REQUESTS ERROR]', err.message);
    if (err.message.includes('not configured')) return res.status(200).json({ error: err.message, configured: false });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
