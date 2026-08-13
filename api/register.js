// api/register.js
// Vercel serverless function — handles BOTH registration and login via Hasura GraphQL.
//
// Contract:
//   POST { name, email, mobile, source }  → register (or auto-login if email already exists)
//   POST { email }                        → login (email only, no name)
//
// Response shape (used by the frontend for both register & login):
//   { success: true,  message, data: { name, email, mobile, source, timestamp }, id? }
//   { success: false, error }
//
// Why one file: a duplicate-email registration and a login are the same
// lookup — "does a profile exist for this email?" — so instead of a
// separate login.js hitting the same table, a duplicate email on /register
// is treated as a successful login rather than a 409 error.

const { hasuraRequest } = require('../lib/hasura');

const CHECK_REGISTRATION = `
  query CheckRegistration($email: String!) {
    registrations(where: { email: { _eq: $email } }, limit: 1) {
      id
      name
      email
      phone
      howkonw
      created_at
    }
  }
`;

const INSERT_REGISTRATION = `
  mutation InsertRegistration($object: registrations_insert_input!) {
    insert_registrations_one(object: $object) {
      id
      name
      email
      phone
      howkonw
      created_at
    }
  }
`;

// Maps a Hasura registrations row → the flat shape the frontend stores
// in localStorage / uses across the app (name, email, mobile, source, timestamp).
function toClientProfile(row) {
  return {
    name: row.name || '',
    email: row.email || '',
    mobile: row.phone || '',
    source: row.howkonw || '',
    timestamp: row.created_at || new Date().toISOString(),
  };
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    const { name = '', email = '', mobile = '', source = '' } = body;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedMobile = mobile.trim();
    const trimmedSource = source.trim();

    // A request with an email but no name is a LOGIN attempt (that's what
    // the frontend's "Log in" tab sends — email only).
    const isLoginAttempt = !trimmedName && !!trimmedEmail;

    if (!trimmedName && !trimmedEmail) {
      return res.status(400).json({
        success: false,
        error: 'At least name or email is required.',
      });
    }

    // ── Look up any existing profile for this email ──
    let existing = null;
    if (trimmedEmail) {
      const result = await hasuraRequest(CHECK_REGISTRATION, {
        email: trimmedEmail,
      });
      existing = result.registrations[0] || null;
    }

    // ── Existing profile found → this is a LOGIN, not an error ──
    // (Covers both the explicit "Log in" tab, and someone re-submitting
    // the register form with an email they already used.)
    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'Welcome back!',
        data: toClientProfile(existing),
        id: existing.id,
      });
    }

    // ── No profile on file ──
    // Pure login attempt (email only) with nothing found: send them to register.
    if (isLoginAttempt) {
      return res.status(404).json({
        success: false,
        error: 'No account found for that email — please register.',
      });
    }

    // ── Fresh registration ──
    const ipaddress =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      null;

    const inserted = await hasuraRequest(INSERT_REGISTRATION, {
      object: {
        name: trimmedName,
        email: trimmedEmail,
        phone: trimmedMobile || null,
        howkonw: trimmedSource || null,
        ipaddress,
      },
    });

    const row = inserted.insert_registrations_one;

    return res.status(200).json({
      success: true,
      message: 'Registration successful.',
      data: toClientProfile(row),
      id: row.id,
    });
  } catch (err) {
    console.error('[REGISTER ERROR]', err);

    // Race condition: two requests for the same brand-new email land at once.
    // Re-fetch and return the winning row as a login instead of failing.
    const errors = err.response?.errors || [];
    const duplicate = errors.some(
      (e) =>
        e.extensions?.code === 'constraint-violation' ||
        e.message?.includes('registrations_email_key') ||
        e.message?.includes('duplicate key value') ||
        e.message?.includes('Uniqueness violation')
    );

    if (duplicate) {
      try {
        const body =
          typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
        const trimmedEmail = (body.email || '').trim().toLowerCase();
        const result = await hasuraRequest(CHECK_REGISTRATION, {
          email: trimmedEmail,
        });
        const row = result.registrations[0];
        if (row) {
          return res.status(200).json({
            success: true,
            message: 'Welcome back!',
            data: toClientProfile(row),
            id: row.id,
          });
        }
      } catch (lookupErr) {
        console.error('[REGISTER RACE LOOKUP ERROR]', lookupErr);
      }
      return res.status(409).json({
        success: false,
        error: 'You have already registered.',
      });
    }

    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error',
    });
  }
};
