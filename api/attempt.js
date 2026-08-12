// api/attempt.js
// POST { userId, questionId, subject, chapterId, questionType, selected, correct, isCorrect, timestamp }
// Records one practice-question attempt. Public, no login required — called
// directly from public/view.html every time a learner checks an answer.
const { hasuraRequest } = require('../lib/hasura');

const INSERT_ATTEMPT = `
  mutation InsertAttempt($object: attempts_insert_input!) {
    insert_attempts_one(object: $object) { id }
  }
`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { userId = 'guest', questionId, subject, chapterId, isCorrect, timestamp } = body;
    if (!subject || typeof isCorrect !== 'boolean') {
      return res.status(400).json({ error: 'subject and isCorrect are required' });
    }
    const result = await hasuraRequest(INSERT_ATTEMPT, {
      object: {
        user_id: userId,
        subject,
        chapter_id: chapterId || null,
        question_id: questionId || null,
        is_correct: isCorrect,
        created_at: timestamp || new Date().toISOString(),
      },
    });
    return res.status(200).json({ success: true, id: result.insert_attempts_one.id });
  } catch (err) {
    console.error('[ATTEMPT ERROR]', err.message);
    if (err.message.includes('not configured')) return res.status(200).json({ error: err.message, configured: false });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
