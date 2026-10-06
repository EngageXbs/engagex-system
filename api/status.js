// Vercel serverless function (Node.js runtime).
// Tells the sign-in page ONE thing: has this workspace already been set up
// (does at least one employee exist)?  It returns only { initialized: true|false } — no names,
// no emails, nothing else.
//
// Why this exists: the database is locked down with Row Level Security, so before anyone
// signs in the browser cannot see the employees table — it always looks empty. Without
// this check the sign-in page wrongly believed the workspace was brand new and showed the
// "Create workspace" form to everybody, which is how duplicate (admin) users got created.
//
// Uses the same two Vercel environment variables as api/create-user.js:
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. (Server-side only — never in config.js.)

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(503).json({ error: 'not configured' }); return; }
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/employees?select=id&limit=1', {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    });
    if (!r.ok) { res.status(502).json({ error: 'lookup failed' }); return; }
    const rows = await r.json();
    res.status(200).json({ initialized: Array.isArray(rows) && rows.length > 0 });
  } catch (e) {
    res.status(502).json({ error: 'lookup failed' });
  }
};
