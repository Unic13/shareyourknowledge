// api/attempt.js
// Vercel serverless function — saves a question attempt via Hasura GraphQL.
// POST   -> save an attempt
// DELETE -> admin-only: delete one attempt by id, or bulk-delete by user_id
//           (email) with optional subject / chapterId / date-range filters
const { hasuraRequest } = require('../lib/hasura');

const INSERT_ATTEMPT = `
  mutation InsertAttempt($object: attempts_insert_input!) {
    insert_attempts_one(object: $object) {
      id
    }
  }
`;

const DELETE_ATTEMPT_BY_ID = `
  mutation DeleteAttemptById($id: bigint!) {
    delete_attempts_by_pk(id: $id) {
      id
      user_id
    }
  }
`;

const DELETE_ATTEMPTS_BY_FILTER = `
  mutation DeleteAttempts($where: attempts_bool_exp!) {
    delete_attempts(where: $where) {
      affected_rows
      returning {
        id
      }
    }
  }
`;

// ---- IP capture -------------------------------------------------
// Vercel's edge network sets x-forwarded-for to "client, proxy1, proxy2…";
// the first entry is the real client IP. Falls back to the raw socket
// address for local/dev environments where that header isn't set.
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  const xri = req.headers['x-real-ip'];
  if (xri) return xri.trim();
  return req.socket?.remoteAddress || null;
}

function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  return (
    ip === '::1' ||
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

// ---- Best-effort geo lookup --------------------------------------
// Free tier (ipapi.co) is fine for low volume. This must never block
// or fail the attempt save — short timeout, swallow all errors.
async function getLocationFromIp(ip) {
  if (!ip || isPrivateOrLocalIp(ip)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (j.error) return null;
    return {
      city: j.city || null,
      region: j.region || null,
      country: j.country_name || null,
      lat: j.latitude ?? null,
      lon: j.longitude ?? null,
    };
  } catch (err) {
    // Timeout, network error, rate limit — never let this break the request.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseBody(req) {
  if (!req.body) return {};
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ======================================
    // SAVE ATTEMPT
    // ======================================
    if (req.method === 'POST') {
      const body = parseBody(req);
      const {
        userId = 'guest',
        questionId,
        subject,
        chapterId,
        questionType,
        selected,
        correct,
        isCorrect = false,
        timestamp,
      } = body || {};

      if (!questionId || !subject || !chapterId) {
        return res.status(400).json({ error: 'questionId, subject, and chapterId are required' });
      }

      const ip = getClientIp(req);
      const isGuest = !userId || userId === 'guest' || userId === 'anonymous';
      const location = await getLocationFromIp(ip) || null;

      const data = await hasuraRequest(INSERT_ATTEMPT, {
        object: {
          // id omitted — DB assigns the next bigserial value
          user_id: userId,
          question_id: questionId,
          subject,
          chapter_id: chapterId,
          question_type: questionType || null,
          selected: selected ?? null,
          correct: correct ?? null,
          is_correct: !!isCorrect,
          ip_address: ip,
          location,
          client_timestamp: timestamp || null,
        },
      });

      return res.status(200).json({ success: true, id: data.insert_attempts_one.id });
    }

    // ======================================
    // DELETE ATTEMPT(S) — admin only
    // ======================================
    if (req.method === 'DELETE') {
      const body = parseBody(req);
      const { adminRole, id, userId, subject, chapterId, dateFrom, dateTo } = body || {};

      // NOTE: this app has no server-side session/auth — `adminRole` is
      // whatever the caller claims in the request body. It stops accidental
      // calls, not a determined attacker. If this endpoint is exposed
      // publicly, put real auth (a verified token, not a client-sent role
      // string) in front of it before relying on this for access control.
      if (adminRole !== 'admin' && adminRole !== 'superadmin') {
        return res.status(403).json({ error: 'Admin role required to delete attempts' });
      }

      // -- Single attempt by id --
      if (id !== undefined && id !== null && id !== '') {
        const data = await hasuraRequest(DELETE_ATTEMPT_BY_ID, { id: Number(id) });
        if (!data.delete_attempts_by_pk) {
          return res.status(404).json({ error: 'Attempt not found' });
        }
        return res.status(200).json({ success: true, deleted: data.delete_attempts_by_pk });
      }

      // -- Bulk delete by user_id (email), optionally narrowed further --
      if (userId) {
        const where = { user_id: { _eq: userId } };
        if (subject) where.subject = { _eq: subject };
        if (chapterId) where.chapter_id = { _eq: chapterId };
        if (dateFrom || dateTo) {
          where.created_at = {};
          if (dateFrom) where.created_at._gte = dateFrom;
          if (dateTo) where.created_at._lte = dateTo;
        }

        const data = await hasuraRequest(DELETE_ATTEMPTS_BY_FILTER, { where });
        return res.status(200).json({
          success: true,
          deleted_count: data.delete_attempts.affected_rows,
        });
      }

      return res.status(400).json({
        error: 'Provide either id (single attempt) or userId (email, for bulk delete)',
      });
    }

    res.setHeader('Allow', 'POST, DELETE, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[ATTEMPT ERROR]', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
