// Vercel serverless function (Node.js runtime) — the CLIENT CREDENTIALS VAULT.
//
// Why a server function? Anything the browser can decrypt, any signed-in teammate could also decrypt
// by reading the page's code. So passwords are encrypted HERE (AES-256-GCM) with a secret that only
// exists as a Vercel environment variable (VAULT_ENCRYPTION_KEY) — never in the database and never in
// the browser. The database only ever holds scrambled text for usernames / passwords / notes.
//
// Every request is checked twice before anything is revealed or changed:
//   1. the caller must be signed in (their Supabase access token is validated), and
//   2. the caller's employee profile must be an authorised role — Super Admin, MD, Operations Head,
//      Digital Marketing Executive — or have "Client credentials access = Yes" switched on by the Super Admin.
// Every view, add, edit and delete is written to the Audit Log (who, what, which client, when).
// If the audit entry cannot be written, nothing is revealed (fail closed).
//
// Environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (already set for api/create-user.js)
//   VAULT_ENCRYPTION_KEY                      (NEW — any long private phrase, 20+ characters. Keep a copy somewhere
//                                              safe: if it is lost or changed, saved credentials cannot be read again.)
//
// POST /api/vault   Authorization: Bearer <access token>
//   { action: 'status' }
//   { action: 'save',   clientId, entry: { id?, platform, url?, username?, password?, notes? } }
//   { action: 'reveal', clientId, entryId }
//   { action: 'remove', clientId, entryId }
// Storage: one row per client in the "config" table, id = "vault_<clientId>".

const crypto = require('crypto');

const VAULT_ROLES = ['super_admin', 'md', 'ops_head', 'dme'];
const MAX = { platform: 80, url: 500, username: 300, password: 500, notes: 2000 };

let _keyCache = null;
function getKey() {
  const secret = process.env.VAULT_ENCRYPTION_KEY;
  if (!secret || String(secret).length < 20) return null;
  if (!_keyCache || _keyCache.secret !== secret) {
    _keyCache = { secret, key: crypto.scryptSync(String(secret), 'engagex-vault-v1', 32) };
  }
  return _keyCache.key;
}
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function encrypt(obj, aad) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return 'v1.' + b64u(iv) + '.' + b64u(c.getAuthTag()) + '.' + b64u(ct);
}
function decrypt(blob, aad) {
  const key = getKey();
  const parts = String(blob || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('bad blob');
  const d = crypto.createDecipheriv('aes-256-gcm', key, unb64u(parts[1]));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(unb64u(parts[2]));
  return JSON.parse(Buffer.concat([d.update(unb64u(parts[3])), d.final()]).toString('utf8'));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(503).json({ error: 'The credentials vault is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Vercel).' });
    return;
  }
  const svc = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };

  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) { res.status(401).json({ error: 'You must be signed in to do this.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const action = String(body.action || '');

  try {
    // ---- 1. who is calling? ----
    const uResp = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token } });
    if (!uResp.ok) { res.status(401).json({ error: 'Your session has expired — please sign in again.' }); return; }
    const user = await uResp.json();
    const email = ((user && user.email) || '').trim();
    if (!email) { res.status(401).json({ error: 'Your session has expired — please sign in again.' }); return; }

    // ---- 2. are they allowed to touch client credentials? ----
    const esc = email.replace(/[%_\\]/g, (c) => '\\' + c);
    const eResp = await fetch(SUPABASE_URL + '/rest/v1/employees?select=id,data&data->>email=ilike.' + encodeURIComponent(esc), { headers: svc });
    if (!eResp.ok) { res.status(502).json({ error: 'Could not verify your permissions — please try again.' }); return; }
    const eRows = await eResp.json();
    const row = Array.isArray(eRows) && eRows[0];
    const emp = row && row.data;
    const allowed = !!emp && emp.status !== 'Removed' && (VAULT_ROLES.includes(emp.role) || emp.vaultAccess === 'Yes');
    const configured = !!getKey();

    if (action === 'status') { res.status(200).json({ ok: true, configured, allowed }); return; }
    if (!allowed) { res.status(403).json({ error: 'You do not have access to client credentials. Ask the Super Admin if you need it.' }); return; }
    if (!configured) { res.status(503).json({ error: 'The vault is not switched on yet: add a VAULT_ENCRYPTION_KEY (20+ characters) in Vercel -> Settings -> Environment Variables, then redeploy.' }); return; }

    const clientId = String(body.clientId || '').trim();
    if (!clientId || clientId.length > 100) { res.status(400).json({ error: 'Missing client.' }); return; }
    const cResp = await fetch(SUPABASE_URL + '/rest/v1/clients?select=id,data&id=eq.' + encodeURIComponent(clientId), { headers: svc });
    const cRows = cResp.ok ? await cResp.json() : [];
    if (!cResp.ok) { res.status(502).json({ error: 'Could not look up the client.' }); return; }
    if (!cRows[0]) { res.status(404).json({ error: 'Client not found.' }); return; }
    const clientName = (cRows[0].data && cRows[0].data.companyName) || '';

    const docId = 'vault_' + clientId;
    const docUrl = SUPABASE_URL + '/rest/v1/config?id=eq.' + encodeURIComponent(docId);

    async function loadDoc() {
      const r = await fetch(docUrl + '&select=data', { headers: svc });
      if (!r.ok) throw new Error('db read failed');
      const rows = await r.json();
      return rows[0] ? rows[0].data : null;
    }
    // optimistic write: only succeeds if nobody else changed the document since we read it
    async function saveDoc(prev, next) {
      next.rev = ((prev && prev.rev) || 0) + 1;
      if (!prev) {
        const r = await fetch(SUPABASE_URL + '/rest/v1/config', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', Prefer: 'return=minimal' }, svc), body: JSON.stringify({ id: docId, data: next }) });
        return r.ok; // 409 on a race -> caller retries
      }
      const r = await fetch(docUrl + '&data->>rev=eq.' + encodeURIComponent(String(prev.rev || 0)), {
        method: 'PATCH', headers: Object.assign({ 'content-type': 'application/json', Prefer: 'return=representation' }, svc),
        body: JSON.stringify({ data: next, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) return false;
      const rows = await r.json();
      return Array.isArray(rows) && rows.length === 1;
    }
    async function audit(actionText, entry, extra) {
      const r = await fetch(SUPABASE_URL + '/rest/v1/auditLog', {
        method: 'POST', headers: Object.assign({ 'content-type': 'application/json', Prefer: 'return=minimal' }, svc),
        body: JSON.stringify({ data: { action: actionText, entity: 'vault', entityId: clientId, prevVal: null, newVal: Object.assign({ client: clientName, platform: (entry && entry.platform) || '', entryId: (entry && entry.id) || null }, extra || {}), byId: row.id, byName: emp.name || email } }),
      });
      if (!r.ok) throw new Error('audit write failed');
    }
    const aadFor = (entryId) => clientId + '|' + entryId;
    const clean = (v, max) => String(v === undefined || v === null ? '' : v).slice(0, max);

    // ---- reveal ----
    if (action === 'reveal') {
      const doc = await loadDoc();
      const entry = doc && (doc.entries || []).find((e) => e.id === body.entryId);
      if (!entry) { res.status(404).json({ error: 'Credential not found.' }); return; }
      let secret;
      try { secret = decrypt(entry.secret, aadFor(entry.id)); }
      catch (e) { res.status(422).json({ error: 'This credential cannot be decrypted with the current VAULT_ENCRYPTION_KEY (was the key changed?).' }); return; }
      await audit('Viewed client credential', entry); // fail closed: no log -> no reveal
      res.status(200).json({ ok: true, entry: { id: entry.id, platform: entry.platform, url: entry.url || '', username: secret.username || '', password: secret.password || '', notes: secret.notes || '' } });
      return;
    }

    // ---- save (add or edit) ----
    if (action === 'save') {
      const inp = body.entry || {};
      const platform = clean(inp.platform, MAX.platform).trim();
      if (!platform) { res.status(400).json({ error: 'Platform is required.' }); return; }
      const editing = !!inp.id;
      const entryId = editing ? String(inp.id) : 'c' + crypto.randomBytes(8).toString('hex');
      const first = await loadDoc();
      if (editing && !((first && first.entries) || []).some((e) => e.id === entryId)) { res.status(404).json({ error: 'Credential not found.' }); return; }
      if (!editing && ((first && first.entries) || []).length >= 100) { res.status(400).json({ error: 'Too many credentials stored for this client (limit 100).' }); return; }
      // log FIRST: if the log cannot be written, nothing is changed
      await audit(editing ? 'Edited client credential' : 'Added client credential', { id: entryId, platform });
      for (let attempt = 0; attempt < 4; attempt++) {
        const doc = attempt === 0 ? first : await loadDoc();
        const next = { kind: 'vault', clientId, entries: ((doc && doc.entries) || []).slice() };
        const now = Date.now();
        let i = next.entries.findIndex((e) => e.id === entryId);
        let entry;
        if (i === -1) {
          if (editing) { res.status(404).json({ error: 'Credential not found.' }); return; }
          entry = { id: entryId, createdAt: now, createdByName: emp.name || email, createdById: row.id };
          next.entries.push(entry);
        } else {
          entry = Object.assign({}, next.entries[i]);
          next.entries[i] = entry;
        }
        entry.platform = platform;
        entry.url = clean(inp.url, MAX.url).trim();
        entry.secret = encrypt({ username: clean(inp.username, MAX.username), password: clean(inp.password, MAX.password), notes: clean(inp.notes, MAX.notes) }, aadFor(entry.id));
        entry.updatedAt = now; entry.updatedByName = emp.name || email; entry.updatedById = row.id;
        if (await saveDoc(doc, next)) { res.status(200).json({ ok: true, id: entry.id }); return; }
      }
      res.status(409).json({ error: 'Someone else changed this client\'s credentials at the same moment — please try again.' });
      return;
    }

    // ---- remove ----
    if (action === 'remove') {
      const first = await loadDoc();
      const target = first && (first.entries || []).find((e) => e.id === body.entryId);
      if (!target) { res.status(404).json({ error: 'Credential not found.' }); return; }
      await audit('Deleted client credential', target); // log FIRST
      for (let attempt = 0; attempt < 4; attempt++) {
        const doc = attempt === 0 ? first : await loadDoc();
        const next = { kind: 'vault', clientId, entries: ((doc && doc.entries) || []).filter((e) => e.id !== target.id) };
        if (await saveDoc(doc, next)) { res.status(200).json({ ok: true }); return; }
      }
      res.status(409).json({ error: 'Someone else changed this client\'s credentials at the same moment — please try again.' });
      return;
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('vault error:', e && e.message);
    res.status(502).json({ error: 'The vault could not complete that request — nothing was revealed. If you were saving or deleting, check the list and try again.' });
  }
};
