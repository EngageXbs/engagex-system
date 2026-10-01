// Injected via page.addInitScript() in the Playwright tests below. Implements just
// enough of the real @supabase/supabase-js v2 client surface (from(), insert(),
// select(), update(), upsert(), delete(), eq(), maybeSingle()/single(), channel(),
// storage) for EX.makeSupabaseDb / EX.makeSupabaseStorage in index.html to run
// against, in-memory, with no network — so we can verify the ADAPTER CODE itself
// behaves correctly (matches the real client's call shapes) without needing a
// live Supabase project.
(function () {
  // addInitScript() re-runs this whole file on every navigation, including a
  // reload — so to correctly simulate a real (server-side, persistent) Supabase
  // backend across reloads, the fake tables are backed by localStorage rather
  // than kept purely in a JS closure that would otherwise reset every time.
  const LS_KEY = '__fake_supabase_tables__';
  const CHANNELS = {};
  let seq = 0;

  function uid() { return 'row_' + (++seq) + '_' + Math.random().toString(36).slice(2, 8); }
  function nowIso() { return new Date().toISOString(); }

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveAll(all) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
  }
  // In-memory view, hydrated from localStorage at init-script run time, and
  // flushed back to localStorage after every mutation.
  const TABLES = {}; // tableName -> Map(id -> {id, data, created_at, updated_at})
  (function hydrate() {
    const all = loadAll();
    Object.keys(all).forEach((name) => { TABLES[name] = new Map(Object.entries(all[name])); });
  })();
  function table(name) { return (TABLES[name] = TABLES[name] || new Map()); }
  function persist() {
    const plain = {};
    Object.keys(TABLES).forEach((name) => { plain[name] = Object.fromEntries(TABLES[name]); });
    saveAll(plain);
  }
  function notify(name) {
    persist();
    const ch = CHANNELS[name];
    if (ch) ch.forEach((cb) => { try { cb(); } catch (e) { console.error(e); } });
  }

  function makeQuery(name) {
    const t = table(name);
    let pendingInsert = null;
    let pendingUpdate = null;
    let pendingUpsert = null;
    let pendingDelete = false;
    let eqId = null;
    let selectCols = '*';
    let orderBy = null;

    const q = {
      insert(row) { pendingInsert = row; return q; },
      update(row) { pendingUpdate = row; return q; },
      upsert(row) { pendingUpsert = row; return q; },
      delete() { pendingDelete = true; return q; },
      select(cols) { selectCols = cols || '*'; return q; },
      eq(col, val) { if (col === 'id') eqId = val; return q; },
      order(col, opts) { orderBy = { col, asc: !opts || opts.ascending !== false }; return q; },

      async maybeSingle() {
        if (eqId == null) return { data: null, error: { message: 'maybeSingle requires .eq(id)' } };
        const row = t.get(eqId);
        if (pendingUpdate) {
          if (!row) return { data: null, error: null };
          const merged = Object.assign({}, row, { data: pendingUpdate.data !== undefined ? pendingUpdate.data : row.data, updated_at: nowIso() });
          t.set(eqId, merged);
          notify(name);
          return { data: null, error: null };
        }
        if (pendingDelete) {
          t.delete(eqId);
          notify(name);
          return { data: null, error: null };
        }
        return { data: row ? { data: row.data } : null, error: null };
      },
      async single() {
        if (pendingInsert) {
          const id = pendingInsert.id || uid();
          const row = { id, data: pendingInsert.data || {}, created_at: nowIso(), updated_at: nowIso() };
          t.set(id, row);
          notify(name);
          return { data: { id }, error: null };
        }
        return this.maybeSingle();
      },
      // Fallback for calls that don't terminate with .single()/.maybeSingle(),
      // e.g. `await sb.from(t).update(x).eq('id',id)` with no further chain,
      // or `await sb.from(t).delete().eq('id',id)`.
      then(resolve, reject) {
        (async () => {
          try {
            if (pendingUpsert) {
              const id = pendingUpsert.id;
              const existing = t.get(id);
              const row = { id, data: pendingUpsert.data !== undefined ? pendingUpsert.data : {}, created_at: existing ? existing.created_at : nowIso(), updated_at: nowIso() };
              t.set(id, row);
              notify(name);
              resolve({ data: null, error: null });
              return;
            }
            if (pendingUpdate && eqId != null) {
              const row = t.get(eqId);
              if (row) {
                const merged = Object.assign({}, row, { data: pendingUpdate.data !== undefined ? pendingUpdate.data : row.data, updated_at: nowIso() });
                t.set(eqId, merged);
              }
              notify(name);
              resolve({ data: null, error: null });
              return;
            }
            if (pendingDelete && eqId != null) {
              t.delete(eqId);
              notify(name);
              resolve({ data: null, error: null });
              return;
            }
            // SELECT (list) path, optionally ordered.
            let rows = Array.from(t.values());
            if (orderBy) rows.sort((a, b) => (a[orderBy.col] > b[orderBy.col] ? 1 : -1) * (orderBy.asc ? 1 : -1));
            resolve({ data: rows, error: null });
          } catch (e) {
            reject ? reject(e) : resolve({ data: null, error: { message: e.message } });
          }
        })();
      },
    };
    return q;
  }

  // ---- Fake Supabase Auth (email+password), backed by localStorage so a
  // signed-in session survives a reload exactly like the real supabase-js
  // client's auto-persisted session does. Good enough to drive EX.renderSignIn
  // / EX.submitLogin / EX.submitBootstrap / EX.signOut in these tests without a
  // live Supabase project. api/create-user.js (server-side, service_role key)
  // is NOT exercised here — see test/qa_create_user_unit.js for that.
  const AUTH_SESSION_KEY = '__fake_supabase_session__';
  const AUTH_USERS_KEY = '__fake_supabase_users__';
  function loadSession() { try { return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function saveSession(s) { try { if (s) localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(AUTH_SESSION_KEY); } catch (e) {} }
  function loadUsers() { try { return JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || '{}'); } catch (e) { return {}; } }
  function saveUsers(u) { try { localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(u)); } catch (e) {} }
  let currentSession = loadSession();
  const authListeners = [];
  function fireAuthChange(event) {
    authListeners.forEach((cb) => { try { cb(event, currentSession); } catch (e) { console.error(e); } });
  }
  const auth = {
    async signUp({ email, password }) {
      const users = loadUsers();
      const key = (email || '').toLowerCase();
      if (users[key]) return { data: { user: null, session: null }, error: { message: 'User already registered' } };
      const user = { id: uid(), email };
      users[key] = { id: user.id, email, password };
      saveUsers(users);
      currentSession = { access_token: 'fake_token_' + user.id, user };
      saveSession(currentSession);
      fireAuthChange('SIGNED_IN');
      return { data: { user, session: currentSession }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const users = loadUsers();
      const u = users[(email || '').toLowerCase()];
      if (!u || u.password !== password) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
      const user = { id: u.id, email: u.email };
      currentSession = { access_token: 'fake_token_' + user.id, user };
      saveSession(currentSession);
      fireAuthChange('SIGNED_IN');
      return { data: { user, session: currentSession }, error: null };
    },
    async signOut() {
      currentSession = null;
      saveSession(null);
      fireAuthChange('SIGNED_OUT');
      return { error: null };
    },
    async getSession() {
      return { data: { session: currentSession }, error: null };
    },
    async getUser() {
      return { data: { user: currentSession ? currentSession.user : null }, error: null };
    },
    onAuthStateChange(cb) {
      authListeners.push(cb);
      setTimeout(() => cb('INITIAL_SESSION', currentSession), 0);
      return { data: { subscription: { unsubscribe() { const i = authListeners.indexOf(cb); if (i >= 0) authListeners.splice(i, 1); } } } };
    },
    // Test-only helper: lets a test create a teammate login the way the real
    // api/create-user.js (service_role key) would, WITHOUT disturbing
    // currentSession — mirrors the whole point of that endpoint existing.
    async __adminCreateUser({ email, password }) {
      const users = loadUsers();
      const key = (email || '').toLowerCase();
      if (users[key]) return { error: 'User already registered' };
      users[key] = { id: uid(), email, password };
      saveUsers(users);
      return { ok: true };
    },
    // Test-only helper: jumps straight to "signed in as this email" without a
    // password, for tests (like the role-crawl) that only care about per-role
    // NAV/permission rendering, not the login mechanism itself (covered by
    // qa_auth_vercel.js). Goes through the real fireAuthChange('SIGNED_IN') path
    // so EX.syncSessionFromAuth() picks it up exactly like a real sign-in would —
    // no special-casing needed in the app code being tested.
    __forceSession({ email }) {
      currentSession = { access_token: 'fake_token_test_' + email, user: { id: 'test_' + email, email } };
      saveSession(currentSession);
      fireAuthChange('SIGNED_IN');
    },
  };

  const fakeClient = {
    auth,
    from(name) { return makeQuery(name); },
    channel(name) {
      const ch = {
        // Key callbacks by the REAL table from the postgres_changes filter (what
        // the adapter actually cares about), not by this channel's own display
        // name — real Supabase routes changes by table regardless of channel name.
        on(_event, filter, cb) {
          const t = (filter && filter.table) || name;
          (CHANNELS[t] = CHANNELS[t] || []).push(cb);
          return ch;
        },
        subscribe() { return ch; },
      };
      return ch;
    },
    removeChannel() {},
    storage: {
      from(_bucket) {
        return {
          async upload(path, _file, _opts) {
            window.__uploadedAssets = window.__uploadedAssets || [];
            window.__uploadedAssets.push(path);
            return { data: { path }, error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: 'https://fake-supabase.local/storage/v1/object/public/assets/' + path } };
          },
        };
      },
    },
  };

  window.supabase = { createClient: () => fakeClient };
  // Tests that load index.html over file:// also load its real <script src="config.js">
  // tag, which runs AFTER this init script and would otherwise clobber window.EX_CONFIG
  // with the real placeholder file's values (notably AI_ENABLED: true, which makes the
  // app attempt a real fetch('/api/ai') — unreachable and CORS-blocked under file://).
  // Locking the property down makes config.js's plain `window.EX_CONFIG = {...}`
  // assignment a silent no-op (non-strict script, so it fails silently rather than
  // throwing), keeping these fake values in effect for the whole test run.
  const FAKE_CONFIG = {
    SUPABASE_URL: 'https://fake-project.supabase.co',
    SUPABASE_ANON_KEY: 'fake-anon-key',
    STORAGE_BUCKET: 'assets',
    AI_ENABLED: false, // no live AI endpoint in these tests; verified separately by test/qa_create_user_unit.js-style unit tests and code review of api/ai.js
  };
  try{
    Object.defineProperty(window, 'EX_CONFIG', { value: FAKE_CONFIG, writable: false, configurable: false });
  }catch(e){ window.EX_CONFIG = FAKE_CONFIG; }
})();
