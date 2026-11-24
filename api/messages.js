// Selene <-> Muse1 private message board.
// Storage: Upstash Redis REST (env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)
// Auth: every request must carry the board key (env: BOARD_KEY) as
//       header "x-board-key" or query ?k=.
// GET  /api/messages        -> { messages: [{author, body, ts}] } newest first (max 300)
// POST /api/messages {author: "selene"|"muse1", body} -> creates a message.

const MAX_POSTS = 300;
const MAX_BODY = 4000;

async function redis(commands) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('storage_not_configured');
  const r = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('storage_error_' + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-board-key');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const key = (req.headers['x-board-key'] || (req.query && req.query.k) || '');
  if (!process.env.BOARD_KEY || key !== process.env.BOARD_KEY) {
    res.status(401).json({ e: 'auth' });
    return;
  }
  try {
    if (req.method === 'GET') {
      const out = await redis([['LRANGE', 'msgs', '0', String(MAX_POSTS - 1)]]);
      const raw = (out[0] && out[0].result) || [];
      const messages = raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
      res.status(200).json({ messages });
      return;
    }
    if (req.method === 'POST') {
      let data = req.body;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
      if (!data || typeof data !== 'object') data = {};
      const author = data.author === 'muse1' ? 'muse1' : 'selene';
      const body = String(data.body || '').trim().slice(0, MAX_BODY);
      if (!body) { res.status(400).json({ e: 'empty' }); return; }
      const msg = { author, body, ts: new Date().toISOString() };
      await redis([['LPUSH', 'msgs', JSON.stringify(msg)], ['LTRIM', 'msgs', '0', String(MAX_POSTS - 1)]]);
      res.status(200).json({ ok: true, message: msg });
      return;
    }
    res.status(405).json({ e: 'method' });
  } catch (e) {
    res.status(500).json({ e: String(e && e.message || e) });
  }
};
