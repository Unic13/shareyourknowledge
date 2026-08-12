// api/data.js
// Vercel serverless function merging what would otherwise be two routes
// (raw registrations/attempts tables + aggregated stats) into one file.
//
// GET /api/data?requesterId=1&type=registrations   → admin/super_admin only
// GET /api/data?requesterId=1&type=attempts         → raw attempt rows, subject-scoped for editors
// GET /api/data?requesterId=1&type=stats            → per-subject totals, subject-scoped for editors
// GET /api/data?requesterId=1&type=stats&subject=SQL → per-chapter breakdown for one subject
//
// ASSUMPTION: your schema only included admin_users / subject_content /
// admin_subjects / subject_update_logs, so `registrations` and `attempts`
// tables are assumed to exist in Hasura already (the original admin.html
// already called api/admin?type=registrations|attempts). If your real
// tables/columns differ, adjust the GraphQL below — nothing else changes.
const { hasuraRequest } = require('../lib/hasura');

const GET_USER = `
  query GetUser($id: bigint!) { admin_users_by_pk(id: $id) { id name role active } }
`;
const GET_EDITOR_SCOPE = `
  query Scope($adminId: bigint!) { admin_subjects(where: { admin_id: { _eq: $adminId } }) { subject_id } }
`;
const GET_SUBJECT_CODES = `
  query Codes($ids: [bigint!]) { subject_content(where: { id: { _in: $ids } }) { id code } }
`;
const GET_REGISTRATIONS = `
  query GetRegistrations { registrations(order_by: { created_at: desc }, limit: 2000) {
    id name email phone created_at
  } }
`;
const GET_ATTEMPTS = `
  query GetAttempts($subjects: [String!]) {
    attempts(
      where: { subject: { _in: $subjects } }
      order_by: { created_at: desc }
      limit: 5000
    ) { id user_id subject chapter_id chapter_title question_id is_correct created_at }
  }
`;
const GET_ATTEMPTS_ALL = `
  query GetAttemptsAll {
    attempts(order_by: { created_at: desc }, limit: 5000) {
      id user_id subject chapter_id chapter_title question_id is_correct created_at
    }
  }
`;

async function getRequesterAndScope(requesterId) {
  if (!requesterId) return { requester: null, allowedCodes: [] };
  const { admin_users_by_pk: requester } = await hasuraRequest(GET_USER, { id: requesterId });
  if (!requester || !requester.active) return { requester: null, allowedCodes: [] };
  if (requester.role !== 'editor') return { requester, allowedCodes: null }; // null = unrestricted

  const { admin_subjects } = await hasuraRequest(GET_EDITOR_SCOPE, { adminId: requesterId });
  if (!admin_subjects.length) return { requester, allowedCodes: [] };
  const { subject_content } = await hasuraRequest(GET_SUBJECT_CODES, { ids: admin_subjects.map((m) => m.subject_id) });
  return { requester, allowedCodes: subject_content.map((s) => s.code) };
}

function summarize(rows) {
  const bySubject = {};
  rows.forEach((r) => {
    const s = (bySubject[r.subject] = bySubject[r.subject] || { subject: r.subject, attempts: 0, correct: 0, learners: new Set() });
    s.attempts += 1;
    if (r.is_correct) s.correct += 1;
    if (r.user_email) s.learners.add(r.user_email);
  });
  return Object.values(bySubject)
    .map((s) => ({
      subject: s.subject,
      attempts: s.attempts,
      correct: s.correct,
      accuracy: s.attempts ? Math.round((s.correct / s.attempts) * 100) : 0,
      unique_learners: s.learners.size,
    }))
    .sort((a, b) => b.attempts - a.attempts);
}

function summarizeByChapter(rows) {
  const byChapter = {};
  rows.forEach((r) => {
    const key = r.chapter_id || r.chapter_title || 'unknown';
    const c = (byChapter[key] = byChapter[key] || { chapter_id: r.chapter_id, chapter_title: r.chapter_title || r.chapter_id, attempts: 0, correct: 0 });
    c.attempts += 1;
    if (r.is_correct) c.correct += 1;
  });
  return Object.values(byChapter)
    .map((c) => ({ ...c, accuracy: c.attempts ? Math.round((c.correct / c.attempts) * 100) : 0 }))
    .sort((a, b) => b.attempts - a.attempts);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { requesterId, type, subject } = req.query;
    const { requester, allowedCodes } = await getRequesterAndScope(requesterId);
    if (!requester) return res.status(401).json({ error: 'Unauthorized' });

    if (type === 'registrations') {
      if (requester.role === 'editor') return res.status(200).json({ message: 'Registrations are only visible to admins.' });
      const { registrations } = await hasuraRequest(GET_REGISTRATIONS);
      return res.status(200).json({ records: registrations, count: registrations.length });
    }

    if (type === 'attempts') {
      if (allowedCodes && !allowedCodes.length) return res.status(200).json({ records: [], count: 0 });
      const { attempts } = allowedCodes
        ? await hasuraRequest(GET_ATTEMPTS, { subjects: allowedCodes })
        : await hasuraRequest(GET_ATTEMPTS_ALL);
      return res.status(200).json({ records: attempts, count: attempts.length });
    }

    if (type === 'stats') {
      if (allowedCodes && subject && !allowedCodes.includes(subject)) {
        return res.status(403).json({ error: 'You are not assigned to this subject' });
      }
      if (allowedCodes && !allowedCodes.length) return res.status(200).json({ bySubject: [] });

      const codesToFetch = subject ? [subject] : allowedCodes;
      const { attempts } = codesToFetch
        ? await hasuraRequest(GET_ATTEMPTS, { subjects: codesToFetch })
        : await hasuraRequest(GET_ATTEMPTS_ALL);

      if (subject) {
        const byChapter = summarizeByChapter(attempts);
        const totals = byChapter.reduce((a, c) => ({ attempts: a.attempts + c.attempts, correct: a.correct + c.correct }), { attempts: 0, correct: 0 });
        return res.status(200).json({
          subject,
          totals: { ...totals, accuracy: totals.attempts ? Math.round((totals.correct / totals.attempts) * 100) : 0 },
          byChapter,
        });
      }
      return res.status(200).json({ bySubject: summarize(attempts) });
    }

    return res.status(400).json({ error: 'Unknown type — use registrations, attempts, or stats' });
  } catch (err) {
    console.error('[DATA ERROR]', err.message);
    if (err.message.includes('not configured')) return res.status(200).json({ error: err.message, configured: false });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
