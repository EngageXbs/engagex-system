// Verifies the real per-employee login overhaul: bootstrap now creates a
// Supabase Auth account (not just an employee row), sign-out returns to a real
// email+password form (not a profile picker), wrong passwords are rejected,
// the session survives a reload, and a Supabase Auth session with no matching
// employee record is treated as an error state rather than silently let in.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const RESULTS = [];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.setDefaultTimeout(4000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('ERR_TUNNEL_CONNECTION_FAILED') && !msg.text().includes('Failed to load resource')) {
      pageErrors.push('CONSOLE: ' + msg.text().slice(0, 300));
    }
  });

  const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
  await page.addInitScript(mock);
  await page.goto('file://' + path.join(DIR, 'index.html'));
  await page.waitForTimeout(400);

  async function check(name, fn) {
    const errBefore = pageErrors.length;
    try {
      await fn();
      const newErrs = pageErrors.slice(errBefore);
      if (newErrs.length) { RESULTS.push({ name, status: 'FAIL', detail: newErrs.join(' | ') }); console.log('FAIL:', name, '-', newErrs.join(' | ')); }
      else { RESULTS.push({ name, status: 'PASS' }); console.log('PASS:', name); }
    } catch (e) {
      RESULTS.push({ name, status: 'FAIL', detail: e.message.split('\n')[0] });
      console.log('FAIL:', name, '-', e.message.split('\n')[0]);
    }
  }

  await check('Bootstrap screen has a real password field (not just name+email)', async () => {
    const hasPw = await page.locator('input[name=password]').count();
    if (!hasPw) throw new Error('bootstrap form has no password field');
  });

  await check('Bootstrap: creates a Supabase Auth account + employee, and signs in', async () => {
    await page.fill('input[name=name]', 'Aarav Mehta');
    await page.fill('input[name=email]', 'aarav@engagex.co');
    await page.fill('input[name=password]', 'TestPass123!');
    await page.click('button:has-text("Create workspace")');
    await page.waitForTimeout(500);
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/Command Center/i.test(txt)) throw new Error('did not land on dashboard after bootstrap, got: ' + txt.slice(0, 200));
    const authEmail = await page.evaluate(() => EX.authEmail);
    if (authEmail !== 'aarav@engagex.co') throw new Error('EX.authEmail not set after bootstrap signup, got: ' + authEmail);
  });

  await check('Sign out returns to a real email+password form, not a profile list', async () => {
    await page.evaluate(() => EX.signOut());
    await page.waitForTimeout(300);
    const hasPicker = await page.locator('button:has-text("Aarav Mehta")').count();
    if (hasPicker) throw new Error('old profile-picker button still shown after sign-out');
    const hasLoginForm = await page.locator('input[name=password]').count();
    if (!hasLoginForm) throw new Error('no email+password login form shown after sign-out');
    const authEmail = await page.evaluate(() => EX.authEmail);
    if (authEmail) throw new Error('EX.authEmail should be cleared after sign-out, got: ' + authEmail);
  });

  await check('Wrong password is rejected with a friendly inline error, no crash', async () => {
    await page.fill('input[name=email]', 'aarav@engagex.co');
    await page.fill('input[name=password]', 'totally-wrong');
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(300);
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/incorrect|invalid/i.test(txt)) throw new Error('no error message shown for wrong password, got: ' + txt.slice(0, 200));
    const txt2 = await page.evaluate(() => document.body.innerText);
    if (/Command Center/i.test(txt2)) throw new Error('wrong password incorrectly signed the user in');
  });

  await check('Correct password signs back in to the same employee', async () => {
    await page.fill('input[name=email]', 'aarav@engagex.co');
    await page.fill('input[name=password]', 'TestPass123!');
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(400);
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/Command Center/i.test(txt)) throw new Error('did not land on dashboard after correct sign-in, got: ' + txt.slice(0, 200));
    const role = await page.evaluate(() => EX.currentRole());
    if (role !== 'super_admin') throw new Error('expected super_admin role after re-login, got ' + role);
  });

  await check('Reload: the Supabase Auth session (not just the old localStorage session) survives a reload', async () => {
    await page.reload();
    await page.waitForTimeout(500);
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/Command Center/i.test(txt)) throw new Error('lost session across reload, got: ' + txt.slice(0, 200));
  });

  await check('Employees page offers "Set up login" for a teammate with an email on file', async () => {
    await page.click('a[href="#/employees"]');
    await page.click('button:has-text("Add employee")');
    await page.fill('#f_name', 'Priya Designer');
    await page.fill('#f_email', 'priya@engagex.co');
    await page.selectOption('#f_role', 'graphic_designer');
    await page.click('form button:has-text("Save")');
    await page.waitForTimeout(400);
    await page.click('text=Priya Designer');
    await page.waitForTimeout(200);
    const hasBtn = await page.locator('button:has-text("Set up login")').count();
    if (!hasBtn) throw new Error('no "Set up login" action on employee detail page');
  });

  await check('Orphaned login: a Supabase Auth session with no matching employee shows a clear error, does not silently let the user in', async () => {
    await page.evaluate(() => EX.signOut());
    await page.waitForTimeout(200);
    await page.evaluate(async () => {
      await EX.sb.auth.signUp({ email: 'ghost@nowhere.co', password: 'GhostPass123!' });
    });
    await page.waitForTimeout(300);
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/no matching employee/i.test(txt)) throw new Error('orphaned-auth-session state not surfaced, got: ' + txt.slice(0, 250));
    if (/Command Center/i.test(txt)) throw new Error('orphaned Supabase Auth session was incorrectly let into the app');
    // Clean up: sign back out so we don't leave a dangling session for other checks.
    await page.evaluate(() => EX.signOut());
    await page.waitForTimeout(200);
  });

  await check('Stale local session: a cleared/expired Supabase Auth session is NOT enough to stay signed in, even if the old local session cache still says staff', async () => {
    // Re-establish a normal signed-in state first.
    await page.fill('input[name=email]', 'aarav@engagex.co');
    await page.fill('input[name=password]', 'TestPass123!');
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(400);
    let txt = await page.evaluate(() => document.body.innerText);
    if (!/Command Center/i.test(txt)) throw new Error('setup failed: could not get back to a signed-in state');
    // Simulate the Supabase Auth session being cleared/expired/revoked WITHOUT
    // going through the app's own EX.signOut() — e.g. signed out on another
    // device/tab, token revoked server-side, or expired while the tab was
    // closed. The app's own localStorage session cache (ex_os_session_v1)
    // still says "staff" at this point.
    await page.evaluate(async () => { await EX.sb.auth.signOut(); });
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForTimeout(600);
    txt = await page.evaluate(() => document.body.innerText);
    if (/Command Center/i.test(txt)) throw new Error('SECURITY BUG: dashboard still shown after the real Supabase Auth session was cleared — stale local session cache let the user stay in');
    const hasLoginForm = await page.locator('input[name=password]').count();
    if (!hasLoginForm) throw new Error('expected to land back on the sign-in form after a cleared auth session, got: ' + txt.slice(0, 200));
    // Leave things signed back in for cleanliness / in case more checks are added later.
    await page.fill('input[name=email]', 'aarav@engagex.co');
    await page.fill('input[name=password]', 'TestPass123!');
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(400);
  });

  console.log('\n=== AUTH OVERHAUL TESTS COMPLETE ===');
  const fails = RESULTS.filter((r) => r.status === 'FAIL');
  console.log('Total:', RESULTS.length, 'Pass:', RESULTS.length - fails.length, 'Fail:', fails.length);
  fails.forEach((f) => console.log('FAIL ::', f.name, '::', f.detail));
  fs.writeFileSync(path.join(__dirname, 'qa_auth_vercel_results.json'), JSON.stringify(RESULTS, null, 2));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
