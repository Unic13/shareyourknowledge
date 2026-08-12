// api/user-stats.js
// GET ?userId=you@example.com → { success, data: { totals, weekTotals, bySubject, last7Days } }
// Public (a learner only ever asks for their own stats by their own id/email,
// mirroring how public/view.html already stores it in localStorage).
//
// NOTE: "minutesPracticed" is an estimate (0.5 min per attempt), not a real
// timed measurement — there's no session-length tracking in the attempts
// table. Flagging this so it isn't mistaken for a precise metric.
const { hasuraRequest } = require('../lib/hasura');

const GET_ATTEMPTS_FOR_USER = `
  query GetAttemptsForUser($userId: String!) {
    attempts(where: { user_id: { _eq: $userId } }, order_by: { created_at: desc }, limit: 5000) {
      subject
      is_correct
      created_at
    }
  }
`;
const MINUTES_PER_ATTEMPT = 0.5;

function dateKeyIST(value) {
  // Bucket by the IST calendar day so "today" lines up with what the
  // learner actually sees, not the server's UTC day.
  const d = new Date(value);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // en-CA => YYYY-MM-DD
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const userId = (req.query?.userId || '').toString().trim();
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const { attempts } = await hasuraRequest(GET_ATTEMPTS_FOR_USER, { userId });

    const correct = attempts.filter(a => a.is_correct).length;
    const totals = {
      attempts: attempts.length,
      correct,
      wrong: attempts.length - correct,
      accuracy: attempts.length ? Math.round((correct / attempts.length) * 100) : 0,
    };

    const bySubjectMap = {};
    attempts.forEach(a => {
      const s = (bySubjectMap[a.subject] = bySubjectMap[a.subject] || { subject: a.subject, attempts: 0, correct: 0 });
      s.attempts += 1;
      if (a.is_correct) s.correct += 1;
    });
    const bySubject = Object.values(bySubjectMap)
      .map(s => ({ ...s, accuracy: s.attempts ? Math.round((s.correct / s.attempts) * 100) : 0 }))
      .sort((a, b) => b.attempts - a.attempts);

    // Last 7 IST calendar days, oldest first, including days with 0 attempts.
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(dateKeyIST(d.toISOString()));
    }
    const byDay = {};
    days.forEach(d => { byDay[d] = { date: d, attempts: 0, correct: 0 }; });
    attempts.forEach(a => {
      const key = dateKeyIST(a.created_at);
      if (byDay[key]) {
        byDay[key].attempts += 1;
        if (a.is_correct) byDay[key].correct += 1;
      }
    });
    const last7Days = days.map(d => ({ ...byDay[d], minutesPracticed: Math.round(byDay[d].attempts * MINUTES_PER_ATTEMPT) }));
    const weekTotals = last7Days.reduce(
      (acc, d) => ({ attempts: acc.attempts + d.attempts, minutesPracticed: acc.minutesPracticed + d.minutesPracticed }),
      { attempts: 0, minutesPracticed: 0 }
    );

    return res.status(200).json({ success: true, data: { totals, weekTotals, bySubject, last7Days } });
  } catch (err) {
    console.error('[USER-STATS ERROR]', err.message);
    if (err.message.includes('not configured')) return res.status(200).json({ error: err.message, configured: false });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
