// Vercel serverless function (Node.js runtime).
// Lets an already-signed-in Super Admin / Ops Head / HR teammate create a real
// Supabase Auth login (email + password) for another employee.
//
// This does NOT use the browser-side supabase-js `signUp()` call on purpose:
// calling signUp() from the admin's own browser would create a session for the
// BRAND NEW user on that same browser tab, silently replacing the admin's own
// signed-in session. Instead, this endpoint uses the Supabase service_role key
// (server-side only) to create the user directly via Supabase's Admin API,
// which never touches any browser session.
//
// Requires two Vercel environment variables (Project -> Settings -> Environment
// Variables): SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// IMPORTANT: SUPABASE_SERVICE_ROLE_KEY must NEVER appear in config.js or any
// other file the browser can read — it has full admin access to your database
// and bypasses every Row Level Security policy. Only set it as a Vercel
// environment variable, which is only ever read here, server-side.
//
// Called by EX.submitSetupLogin() in index.html with:
//   Authorization: Bearer <the calling employee's own Supabase access token>
//   { email, password }
// -> 200 { ok: true, userId } | 4xx/5xx { error }

const ADMIN_ROLES = ['super_admin', 'md', 'ops_head', 'dm_manager', 'creative_head', 'hr'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(503).json({
      error: 'Creating logins is not configured on this deployment (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable in Vercel).',
    });
    return;
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const callerToken = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!callerToken) {
    res.status(401).json({ error: 'You must be signed in to do this.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  const email = String(body.email || '').trim();
  const password = String(body.password || '');

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }

  try {
    // 1. Who is calling? Validate their access token against Supabase Auth —
    //    this proves the request really comes from someone currently signed in,
    //    not just anyone who can guess this URL.
    const callerResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + callerToken },
    });
    if (!callerResp.ok) {
      res.status(401).json({ error: 'Your session has expired — please sign in again.' });
      return;
    }
    const callerUser = await callerResp.json();
    const callerEmail = (callerUser && callerUser.email || '').trim();
    if (!callerEmail) {
      res.status(401).json({ error: 'Your session has expired — please sign in again.' });
      return;
    }

    // 2. Is the caller an employee with a role allowed to create logins for
    //    others? (Mirrors the Employees nav permission in index.html.)
    const escapedEmail = callerEmail.replace(/[%_\\]/g, (c) => '\\' + c);
    const empResp = await fetch(
      SUPABASE_URL + '/rest/v1/employees?select=data&data->>email=ilike.' + encodeURIComponent(escapedEmail),
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
    );
    if (!empResp.ok) {
      res.status(502).json({ error: 'Could not verify your permissions — please try again.' });
      return;
    }
    const empRows = await empResp.json();
    const callerEmp = Array.isArray(empRows) && empRows[0] && empRows[0].data;
    if (!callerEmp || !ADMIN_ROLES.includes(callerEmp.role)) {
      res.status(403).json({ error: 'Only Super Admin / MD, Operations Head / Digital Marketing Manager, Creative Head or HR can set up logins for teammates.' });
      return;
    }

    // 3. Create the new login via the Admin API. This uses the service_role
    //    key end-to-end and never touches the caller's own browser session.
    const createResp = await fetch(SUPABASE_URL + '/auth/v1/admin/users', {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: 'Bearer ' + SERVICE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const createJson = await createResp.json().catch(() => ({}));
    if (!createResp.ok) {
      const msg = (createJson && (createJson.msg || createJson.error_description || createJson.error)) || 'Could not create the login.';
      res.status(createResp.status === 422 ? 409 : 502).json({ error: msg });
      return;
    }

    res.status(200).json({ ok: true, userId: createJson.id });
  } catch (e) {
    console.error('create-user error:', e);
    res.status(502).json({ error: (e && e.message) || 'Could not create the login.' });
  }
};
