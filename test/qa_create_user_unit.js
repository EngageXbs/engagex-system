// Unit-tests api/create-user.js directly (no browser, no live Supabase project)
// by monkey-patching global.fetch to stand in for Supabase's REST/Auth endpoints,
// and calling the exported handler with fake req/res objects — same pattern
// local-server.js uses to mount the real handler for browser tests, but here we
// drive it straight from Node so we can assert on status codes precisely.
const path = require('path');
const HANDLER_PATH = path.join(__dirname, '..', 'api', 'create-user.js');
const RESULTS = [];

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

async function check(name, fn) {
  try {
    await fn();
    RESULTS.push({ name, status: 'PASS' });
    console.log('PASS:', name);
  } catch (e) {
    RESULTS.push({ name, status: 'FAIL', detail: e.message });
    console.log('FAIL:', name, '-', e.message);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; process.env[k] = env[k]; }
  delete require.cache[require.resolve(HANDLER_PATH)];
  const handler = require(HANDLER_PATH);
  try {
    return await fn(handler);
  } finally {
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    delete require.cache[require.resolve(HANDLER_PATH)];
  }
}

(async () => {
  await check('Missing SUPABASE_URL/SERVICE_ROLE_KEY -> 503, does not attempt network calls', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete require.cache[require.resolve(HANDLER_PATH)];
    const handler = require(HANDLER_PATH);
    const res = fakeRes();
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    assert(res.statusCode === 503, 'expected 503, got ' + res.statusCode);
  });

  await withEnv({ SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key' }, async (handler) => {
    await check('GET request -> 405', async () => {
      const res = fakeRes();
      await handler({ method: 'GET', headers: {}, body: {} }, res);
      assert(res.statusCode === 405, 'expected 405, got ' + res.statusCode);
    });

    await check('No Authorization header -> 401, no network calls made', async () => {
      const origFetch = global.fetch;
      let called = false;
      global.fetch = async () => { called = true; throw new Error('should not be called'); };
      try {
        const res = fakeRes();
        await handler({ method: 'POST', headers: {}, body: { email: 'a@b.co', password: 'longenough1' } }, res);
        assert(res.statusCode === 401, 'expected 401, got ' + res.statusCode);
        assert(!called, 'should not have called fetch with no auth header');
      } finally { global.fetch = origFetch; }
    });

    await check('Short password -> 400 before any network call', async () => {
      const origFetch = global.fetch;
      global.fetch = async () => { throw new Error('should not be called'); };
      try {
        const res = fakeRes();
        await handler({ method: 'POST', headers: { authorization: 'Bearer sometoken' }, body: { email: 'a@b.co', password: 'short' } }, res);
        assert(res.statusCode === 400, 'expected 400, got ' + res.statusCode);
      } finally { global.fetch = origFetch; }
    });

    await check('Invalid/expired caller token -> 401', async () => {
      const origFetch = global.fetch;
      global.fetch = async (url) => {
        if (String(url).includes('/auth/v1/user')) return { ok: false, status: 401, json: async () => ({}) };
        throw new Error('unexpected fetch to ' + url);
      };
      try {
        const res = fakeRes();
        await handler({ method: 'POST', headers: { authorization: 'Bearer badtoken' }, body: { email: 'new@engagex.co', password: 'longenough1' } }, res);
        assert(res.statusCode === 401, 'expected 401, got ' + res.statusCode);
      } finally { global.fetch = origFetch; }
    });

    await check('Valid token but caller is not an admin-role employee -> 403, never calls admin/users', async () => {
      const origFetch = global.fetch;
      global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ email: 'exec@engagex.co' }) };
        if (u.includes('/rest/v1/employees')) return { ok: true, json: async () => ([{ data: { role: 'sales_exec', email: 'exec@engagex.co' } }]) };
        if (u.includes('/auth/v1/admin/users')) throw new Error('should never create a user for a non-admin caller');
        throw new Error('unexpected fetch to ' + u);
      };
      try {
        const res = fakeRes();
        await handler({ method: 'POST', headers: { authorization: 'Bearer goodtoken' }, body: { email: 'new@engagex.co', password: 'longenough1' } }, res);
        assert(res.statusCode === 403, 'expected 403, got ' + res.statusCode);
      } finally { global.fetch = origFetch; }
    });

    await check('Valid admin-role caller -> creates user via Admin API with service_role key, returns 200', async () => {
      const origFetch = global.fetch;
      let adminCallBody = null;
      let adminCallHeaders = null;
      global.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ email: 'hr@engagex.co' }) };
        if (u.includes('/rest/v1/employees')) return { ok: true, json: async () => ([{ data: { role: 'hr', email: 'hr@engagex.co' } }]) };
        if (u.includes('/auth/v1/admin/users')) {
          adminCallBody = JSON.parse(opts.body);
          adminCallHeaders = opts.headers;
          return { ok: true, json: async () => ({ id: 'new-user-id-123' }) };
        }
        throw new Error('unexpected fetch to ' + u);
      };
      try {
        const res = fakeRes();
        await handler({ method: 'POST', headers: { authorization: 'Bearer goodtoken' }, body: { email: 'newhire@engagex.co', password: 'longenough1' } }, res);
        assert(res.statusCode === 200, 'expected 200, got ' + res.statusCode + ' body: ' + JSON.stringify(res.body));
        assert(res.body && res.body.ok === true, 'expected { ok: true, ... }, got ' + JSON.stringify(res.body));
        assert(res.body.userId === 'new-user-id-123', 'expected userId passed through, got ' + JSON.stringify(res.body));
        assert(adminCallBody.email === 'newhire@engagex.co', 'wrong email sent to Admin API');
        assert(adminCallBody.password === 'longenough1', 'wrong password sent to Admin API');
        assert(adminCallBody.email_confirm === true, 'new user should be pre-confirmed (email_confirm:true)');
        assert(adminCallHeaders.Authorization === 'Bearer fake-service-key', 'Admin API call must use the service_role key, not the caller token');
      } finally { global.fetch = origFetch; }
    });

    await check('Admin API reports the email already exists -> 409, friendly message passed through', async () => {
      const origFetch = global.fetch;
      global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ email: 'hr@engagex.co' }) };
        if (u.includes('/rest/v1/employees')) return { ok: true, json: async () => ([{ data: { role: 'hr', email: 'hr@engagex.co' } }]) };
        if (u.includes('/auth/v1/admin/users')) return { ok: false, status: 422, json: async () => ({ msg: 'A user with this email address has already been registered' }) };
        throw new Error('unexpected fetch to ' + u);
      };
      try {
        const res = fakeRes();
        await handler({ method: 'POST', headers: { authorization: 'Bearer goodtoken' }, body: { email: 'dupe@engagex.co', password: 'longenough1' } }, res);
        assert(res.statusCode === 409, 'expected 409, got ' + res.statusCode);
        assert(/already/i.test(res.body.error), 'expected a friendly "already registered" message, got ' + JSON.stringify(res.body));
      } finally { global.fetch = origFetch; }
    });
  });

  console.log('\n=== create-user.js UNIT TESTS COMPLETE ===');
  const fails = RESULTS.filter((r) => r.status === 'FAIL');
  console.log('Total:', RESULTS.length, 'Pass:', RESULTS.length - fails.length, 'Fail:', fails.length);
  fails.forEach((f) => console.log('FAIL ::', f.name, '::', f.detail));
  process.exit(fails.length ? 1 : 0);
})();
