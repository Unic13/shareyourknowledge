// api/notes.js
// GET  ?userId=you@x.com                       → { success, data: [ all notes for this user ] }
// GET  ?userId=you@x.com&chapterId=c_123        → { success, data: { content, drawing, ... } | null }
// POST { userId, subject, chapterId, chapterTitle, content, drawing } → upsert one note
//
// Public, no login required — mirrors api/feedback.js / api/attempt.js.
// userId is whatever public/view.html already uses everywhere else
// (state.userData.email || state.userData.name, or 'guest' for anonymous
// browsing, though guests are expected to rely on localStorage instead).
//
// `drawing` is a base64 PNG data URL from the pen/freehand tool in the
// notes drawer — stored alongside typed `content`, same note per chapter.
const { hasuraRequest } = require('../lib/hasura');

const GET_ALL_FOR_USER = `
  query GetNotes($userId: String!) {
    notes(where: { user_id: { _eq: $userId } }, order_by: { updated_at: desc }) {
      id subject chapter_id chapter_title content drawing updated_at
    }
  }
`;
const GET_ONE = `
  query GetNote($userId: String!, $chapterId: String!) {
    notes(where: { user_id: { _eq: $userId }, chapter_id: { _eq: $chapterId } }, limit: 1) {
      id subject chapter_id chapter_title content drawing updated_at
    }
  }
`;
const UPSERT_NOTE = `
  mutation UpsertNote($object: notes_insert_input!) {
    insert_notes_one(
      object: $object
      on_conflict: { constraint: notes_user_id_chapter_id_key, update_columns: [subject, chapter_title, content, drawing, updated_at] }
    ) { id chapter_id content drawing updated_at }
  }
`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const userId = (req.query?.userId || '').toString().trim();
      const chapterId = (req.query?.chapterId || '').toString().trim();
      if (!userId) return res.status(400).json({ error: 'userId is required' });

      if (chapterId) {
        const { notes } = await hasuraRequest(GET_ONE, { userId, chapterId });
        return res.status(200).json({ success: true, data: notes[0] || null });
      }
      const { notes } = await hasuraRequest(GET_ALL_FOR_USER, { userId });
      return res.status(200).json({ success: true, data: notes });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { userId, subject, chapterId, chapterTitle, content, drawing } = body;
      if (!userId || !chapterId) return res.status(400).json({ error: 'userId and chapterId are required' });

      const result = await hasuraRequest(UPSERT_NOTE, {
        object: {
          user_id: userId,
          subject: subject || null,
          chapter_id: chapterId,
          chapter_title: chapterTitle || null,
          content: content || '',
          drawing: drawing || null,
          updated_at: new Date().toISOString(),
        },
      });
      return res.status(200).json({ success: true, data: result.insert_notes_one });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[NOTES ERROR]', err.message);
    if (err.message.includes('not configured')) return res.status(200).json({ error: err.message, configured: false });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
