// api/feedback.js
// POST /api/feedback                                        → public, learner submits feedback
//      body: { userId, subject, rating (1-5), message }
// GET  /api/feedback?subject=SQL                             → public: aggregate + recent 10 for one subject
//                                                                (unchanged behaviour, used by the learner app)
// GET  /api/feedback?requesterId=1                           → admin view: overall totals + per-subject
//                                                                breakdown, scoped to the editor's mapped
//                                                                subjects (admin/super_admin see everything)
// GET  /api/feedback?requesterId=1&subject=SQL                → admin view: recent feedback for one subject
//                                                                (403 if an editor isn't mapped to it)
const { hasuraRequest } = require('../lib/hasura');

const INSERT_FEEDBACK = `
  mutation InsertFeedback($object: feedback_insert_input!) {
    insert_feedback_one(object: $object) {
      id
    }
  }
`;
const GET_FEEDBACK_STATS = `
  query GetFeedbackStats($where: feedback_bool_exp!) {
    feedback_aggregate(where: $where) {
      aggregate {
        count
        avg { rating }
      }
    }
    recent: feedback(where: $where, order_by: { created_at: desc }, limit: 10) {
      id
      subject
      rating
      message
      created_at
      chapter_id
    }
  }
`;
// Hasura can't GROUP BY in a single aggregate query without a custom view,
// so for the "all subjects" admin overview we pull a bounded set of raw
// rows and group them in JS instead — same pattern as api/data.js.
const GET_FEEDBACK_ROWS = `
  query GetFeedbackRows($where: feedback_bool_exp!) {
    feedback(where: $where, order_by: { created_at: desc }, limit: 5000) {
      subject
      rating
    }
  }
`;
const GET_USER = `
  query GetUser($id: bigint!) { admin_users_by_pk(id: $id) { id name role active } }
`;
const GET_EDITOR_SCOPE = `
  query Scope($adminId: bigint!) { admin_subjects(where: { admin_id: { _eq: $adminId } }) { subject_id } }
`;
const GET_SUBJECT_CODES = `
  query Codes($ids: [bigint!]) { subject_content(where: { id: { _in: $ids } }) { id code } }
`;

function parseBody(req) {
  if (!req.body) return {};
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
}

async function getRequesterAndScope(requesterId) {
  if (!requesterId) return { requester: null, allowedCodes: null };
  const { admin_users_by_pk: requester } = await hasuraRequest(GET_USER, { id: requesterId });
  if (!requester || !requester.active) return { requester: null, allowedCodes: null };
  if (requester.role !== 'editor') return { requester, allowedCodes: null }; // null = unrestricted

  const { admin_subjects } = await hasuraRequest(GET_EDITOR_SCOPE, { adminId: requesterId });
  if (!admin_subjects.length) return { requester, allowedCodes: [] };
  const { subject_content } = await hasuraRequest(GET_SUBJECT_CODES, { ids: admin_subjects.map((m) => m.subject_id) });
  return { requester, allowedCodes: subject_content.map((s) => s.code) };
}

function groupBySubject(rows) {
  const bySubject = {};
  rows.forEach((r) => {
    const key = r.subject || '(no subject)';
    const s = (bySubject[key] = bySubject[key] || { subject: key, count: 0, total: 0 });
    s.count += 1;
    s.total += r.rating;
  });
  return Object.values(bySubject)
    .map((s) => ({ subject: s.subject, count: s.count, averageRating: Math.round((s.total / s.count) * 10) / 10 }))
    .sort((a, b) => b.count - a.count);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      const body = parseBody(req);
      const { userId = 'guest', subject = null, rating, message = '', chapter_id = null } = body || {};
      const r = Number(rating);
      if (!r || r < 1 || r > 5) {
        return res.status(400).json({ error: 'rating must be a number 1-5' });
      }
      const data = await hasuraRequest(INSERT_FEEDBACK, {
        object: { user_id: userId, subject, rating: r, message: message.slice(0, 2000), chapter_id = chapterId },
      });
      return res.status(200).json({ success: true, id: data.insert_feedback_one.id });
    }

    if (req.method === 'GET') {
      const subject = (req.query?.subject || '').toString().trim();
      const requesterId = req.query?.requesterId;

      // Public path — unchanged from your original file, still used by the
      // learner-facing app with no login involved.
      if (!requesterId) {
        const where = subject ? { subject: { _eq: subject } } : {};
        const data = await hasuraRequest(GET_FEEDBACK_STATS, { where });
        const agg = data.feedback_aggregate.aggregate;
        return res.status(200).json({
          success: true,
          data: {
            count: agg.count,
            averageRating: agg.avg?.rating ? Math.round(agg.avg.rating * 10) / 10 : 0,
            recent: data.recent,
          },
        });
      }

      // Admin path — logged-in requester, scoped for editors.
      const { requester, allowedCodes } = await getRequesterAndScope(requesterId);
      if (!requester) return res.status(401).json({ error: 'Unauthorized' });
      if (subject && allowedCodes && !allowedCodes.includes(subject)) {
        return res.status(403).json({ error: 'You are not assigned to this subject' });
      }
      if (!subject && allowedCodes && !allowedCodes.length) {
        return res.status(200).json({ success: true, data: { count: 0, averageRating: 0, recent: [], bySubject: [] } });
      }

      const where = subject
        ? { subject: { _eq: subject } }
        : allowedCodes
        ? { subject: { _in: allowedCodes } }
        : {};

      const data = await hasuraRequest(GET_FEEDBACK_STATS, { where });
      const agg = data.feedback_aggregate.aggregate;
      const result = {
        count: agg.count,
        averageRating: agg.avg?.rating ? Math.round(agg.avg.rating * 10) / 10 : 0,
        recent: data.recent,
      };

      if (!subject) {
        const rowsData = await hasuraRequest(GET_FEEDBACK_ROWS, { where });
        result.bySubject = groupBySubject(rowsData.feedback);
      }

      return res.status(200).json({ success: true, data: result });
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[FEEDBACK ERROR]', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
