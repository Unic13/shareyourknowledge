// api/register.js
// POST { name, email, mobile, source } → upsert a registration (learner "signs up")
// POST { email }                        → login-by-email: look up an existing registration
// Public, no login required — mirrors what the learner app in public/view.html expects.
const { hasuraRequest } = require('../lib/hasura');

const UPSERT_REGISTRATION = `
  mutation UpsertRegistration($object: registrations_insert_input!) {
    insert_registrations_one(
      object: $object
      on_conflict: { constraint: registrations_email_key, update_columns: [name, phone, source] }
    ) { id name email phone source created_at }
  }
`;
const GET_BY_EMAIL = `
  query GetRegistration($email: String!) {
    registrations(where: { email: { _eq: $email } }, limit: 1) {
      id name email phone source created_at
    }
  }
`;

function toClientShape(row) {
  return { name: row.name, email: row.email, mobile: row.phone, source: row.source, timestamp: row.created_at };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { name, email, mobile, source } = body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    // Login flow: only an email was sent, no name — look up the existing profile.
    if (!name) {
      const { registrations } = await hasuraRequest(GET_BY_EMAIL, { email: email.trim().toLowerCase() });
      if (!registrations.length) return res.status(200).json({ success: false, error: 'No saved profile for that email' });
      return res.status(200).json({ success: true, data: toClientShape(registrations[0]) });
    }

    // Register / update flow.
    const result = await hasuraRequest(UPSERT_REGISTRATION, {
      object: { name: name.trim(), email: email.trim().toLowerCase(), phone: mobile || null, source: source || null },
    });
    return res.status(200).json({ success: true, data: toClientShape(result.insert_registrations_one) });
  } catch (err) {
    console.error('[REGISTER ERROR]', err.message);
    if (err.message.includes('not configured')) return res.status(200).json({ error: err.message, configured: false });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
