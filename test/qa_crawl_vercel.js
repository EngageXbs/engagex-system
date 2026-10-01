// Comprehensive QA crawler: for every role, visit every nav item it can see and
// every portal page, capturing JS exceptions, console errors, and obviously-broken
// rendering (undefined/NaN/[object Object] leaking into the UI).
const { chromium } = require('playwright');
const fs = require('fs');
const DIR = require('path').join(__dirname, '..');

const ISSUES = []; // {role, route, kind, detail}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  let currentCtx = { role: 'BOOT', route: '-' };
  page.on('pageerror', e => ISSUES.push({ ...currentCtx, kind: 'PAGEERROR', detail: e.message.split('\n')[0] }));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (t.includes('ERR_TUNNEL_CONNECTION_FAILED')) return; // known: AI mock network noise, not a real bug
      ISSUES.push({ ...currentCtx, kind: 'CONSOLE_ERROR', detail: t.slice(0, 200) });
    }
  });
  const mock = fs.readFileSync(require('path').join(__dirname, 'mock-supabase.js'), 'utf8');
  await page.addInitScript(mock);
  await page.goto('file://' + DIR + '/index.html');
  await page.waitForTimeout(300);

  async function bodyBrokenCheck(role, route) {
    const txt = await page.evaluate(() => document.body.innerText);
    if (/\bundefined\b/.test(txt)) ISSUES.push({ role, route, kind: 'RENDER', detail: 'literal "undefined" visible in page text' });
    if (/\bNaN\b/.test(txt)) ISSUES.push({ role, route, kind: 'RENDER', detail: 'literal "NaN" visible in page text' });
    if (/\[object Object\]/.test(txt)) ISSUES.push({ role, route, kind: 'RENDER', detail: '[object Object] visible in page text' });
  }

  currentCtx = { role: 'BOOT', route: 'bootstrap' };
  await page.fill('input[name=name]', 'Aarav Mehta');
  await page.fill('input[name=email]', 'aarav@engagex.co');
  await page.fill('input[name=password]', 'TestPass123!');
  await page.click('button:has-text("Create workspace")');
  await page.waitForTimeout(300);

  // --- Seed one employee per role ---
  const ROLES = ['ops_head','hr','accounts','sales_exec','dme','graphic_designer','video_editor','videographer','intern','parttime','outsourced_editor'];
  currentCtx = { role: 'BOOT', route: 'seed-employees' };
  for (const r of ROLES) {
    console.log('seeding employee for role', r);
    await page.click('a[href="#/employees"]');
    await page.click('button:has-text("Add employee")');
    await page.fill('#f_name', 'Test ' + r);
    await page.fill('#f_email', r + '@engagex.co');
    await page.selectOption('#f_role', r);
    await page.click('form button:has-text("Save")');
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => { if (document.getElementById('ex-modal-backdrop')) EX.closeModal(); });

  // --- Seed core business data as super_admin so pages aren't all empty-state ---
  currentCtx = { role: 'BOOT', route: 'seed-data' };
  await page.evaluate(async () => {
    const empByRole = (role) => EX.get('employees').find(e => e.role === role);
    const dme = empByRole('dme');
    // Lead
    const leadId = await EX.add('leads', { company: 'Zenith Retailers', industry: 'Retail', country: 'India', stage: 'New', website: 'zenith.example', requirements: 'Need social + ads', goals: ['Leads'], budget: 50000, timeline: '3 months' });
    // Proposal directly (not via lead) using our new create-proposal flow's data shape
    const propId = await EX.add('proposals', { leadId: null, company: 'Bright Interiors', status: 'Draft', services: [], monthlyFee: 40000, oneTimeFee: 10000, adSpend: 5000, durationMonths: 12, paymentTerms: 'Net 15', sections: {}, versions: [] });
    // Client directly
    const clientId = await EX.add('clients', { companyName: 'Acme Corp', contactPerson: 'Ravi', email: 'ravi@acme.example', phone: '9999999999', industry: 'FMCG', country: 'India', currency: 'INR', status: 'Active', serviceStatus: 'Active', assignedDme: dme ? dme.id : null, monthlyFee: 50000, adSpendPassthrough: 20000, billingDay: 5, paymentTerms: 'Net 15', services: [{ cat: 'Social Media', item: 'Instagram Management', qty: 20 }], platforms: [], contractStart: Date.now(), durationMonths: 12 });
    window.__seedIds = { leadId, propId, clientId };
    // Task
    await EX.add('tasks', { title: 'Design homepage banner', clientId, type: 'Design', assignedTo: dme ? dme.id : null, assignedToName: dme ? dme.name : null, priority: 'Medium', status: 'To Do', revisionCount: 0 });
    // Invoice (match EX.saveInvoice's real shape)
    await EX.add('invoices', { clientId, invoiceNumber: EX.seqNumber('invoices','INV'), billingPeriod: 'September 2026', lineItems: [{ desc: 'Monthly Retainer', qty: 1, rate: 50000, amount: 50000 }], subtotal: 50000, taxRate: 18, taxAmount: 9000, total: 59000, currency: 'INR', dueDate: Date.now() + 7 * 86400000, status: 'Sent', notes: '' });
    // Vendor + vendor invoice + expense (match real field shapes)
    const vendorId = await EX.add('vendors', { name: 'Meta Ads', service: 'Ad Platform', type: 'Vendor' });
    await EX.add('vendorInvoices', { vendorId, amount: 15000, status: 'Pending', dueDate: Date.now() + 5 * 86400000 });
    await EX.add('expenses', { category: 'Software', amount: 4999, date: Date.now(), description: 'Design tool subscription' });
    // Bank account
    await EX.add('bankAccounts', { bankName: 'HDFC Bank', accountLabel: 'Current A/C', currency: 'INR', openingBalance: 200000, transactions: [] });
    // Company asset
    await EX.add('companyAssets', { name: 'MacBook Pro 14"', category: 'Laptop', serialNumber: 'MBP-SEED-1', status: 'In Use', assignedTo: dme ? dme.id : null, purchaseDate: Date.now() });
    // Video shoot
    await EX.add('videoShoots', { clientId, title: 'Product shoot', date: Date.now() + 3 * 86400000, status: 'Scheduled', location: 'Studio A' });
    // Support ticket (match EX.saveTicket's real shape)
    await EX.add('supportTickets', { clientId, category: 'Technical Problem', priority: 'Medium', message: 'Login issue on portal', status: 'Open' });
    // Meeting (match EX.saveMeeting's real shape)
    await EX.add('meetings', { clientId, date: Date.now() + 2 * 86400000, notes: 'Monthly review', status: 'Scheduled' });
  });
  await page.waitForTimeout(400);

  // --- Crawl staff NAV for every role ---
  const NAV = await page.evaluate(() => EX.NAV.flatMap(g => g.items));
  const PORTAL_NAV = await page.evaluate(() => EX.PORTAL_NAV.map(i => i.key));
  const ROLE_LABEL = await page.evaluate(() => EX.ROLES);

  async function navAllowed(role, item) {
    return item.roles === '*' || item.roles.includes(role);
  }

  async function closeAnyModal() {
    await page.evaluate(() => { if (document.getElementById('ex-modal-backdrop')) EX.closeModal(); }).catch(() => {});
  }
  async function signInAs(name) {
    // Real auth means each employee would need their own Supabase Auth login
    // to sign in through the UI, which this crawl doesn't set up per seeded
    // role (that flow is covered separately by qa_auth_vercel.js). What THIS
    // test cares about is per-role NAV/permission rendering, so it uses the
    // mock's __forceSession() test helper to jump straight to "signed in as
    // this email" — that still goes through the real EX.syncSessionFromAuth()
    // code path (not a side door that bypasses it), so the app's own guard
    // against a stale/missing auth session stays exercised honestly.
    await closeAnyModal();
    await page.evaluate((nm) => {
      const emp = EX.get('employees').find(e => e.name === nm);
      if (!emp) throw new Error('seeded employee not found: ' + nm);
      EX.sb.auth.__forceSession({ email: emp.email });
    }, name);
    await page.waitForTimeout(300);
  }

  async function crawlRole(role, name) {
    console.log('--- crawling role:', role, name, '---');
    await signInAs(name);
    for (const item of NAV) {
      if (!(await navAllowed(role, item))) continue;
      currentCtx = { role, route: item.key };
      process.stdout.write('  > ' + item.key + '\n');
      try {
        await page.click(`a[href="#/${item.key}"]`, { timeout: 2500 });
        await page.waitForTimeout(180);
        await bodyBrokenCheck(role, item.key);
        // try clicking into the first row of any data table, if present, to exercise detail views
        const rowCount = await page.locator('table tbody tr').count().catch(() => 0);
        if (rowCount > 0) {
          const firstRowText = await page.locator('table tbody tr').first().innerText().catch(() => '');
          if (!/No .* yet|empty/i.test(firstRowText)) {
            await page.locator('table tbody tr').first().click({ timeout: 1500 }).catch((e) => { ISSUES.push({ role, route: item.key + '/rowclick', kind: 'NAV_CLICK_FAIL', detail: e.message.split('\n')[0] }); });
            await page.waitForTimeout(180);
            await bodyBrokenCheck(role, item.key + '/detail');
            await closeAnyModal();
          }
        }
      } catch (e) {
        ISSUES.push({ role, route: item.key, kind: 'NAV_CLICK_FAIL', detail: e.message.split('\n')[0] });
        await closeAnyModal();
      }
    }
  }

  // super_admin (Aarav Mehta) first
  await crawlRole('super_admin', 'Aarav Mehta');
  for (const r of ROLES) {
    await crawlRole(r, 'Test ' + r);
  }

  // --- Crawl client portal (as super_admin previewing Acme Corp) ---
  currentCtx = { role: 'PORTAL', route: 'enter' };
  await signInAs('Aarav Mehta');
  await page.click('a[href="#/clients"]');
  await page.waitForTimeout(300);
  await page.click('text=Acme Corp');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Preview client portal")');
  await page.waitForTimeout(300);
  for (const key of PORTAL_NAV) {
    currentCtx = { role: 'PORTAL', route: key };
    try {
      await page.click(`a[href="#/${key}"]`);
      await page.waitForTimeout(300);
      await bodyBrokenCheck('PORTAL', key);
    } catch (e) {
      ISSUES.push({ role: 'PORTAL', route: key, kind: 'NAV_CLICK_FAIL', detail: e.message.split('\n')[0] });
    }
  }

  console.log('\n=== NAV CRAWL COMPLETE ===');
  console.log('Total issues found:', ISSUES.length);
  ISSUES.forEach(i => console.log(`[${i.kind}] role=${i.role} route=${i.route} :: ${i.detail}`));
  fs.writeFileSync(__dirname + '/qa_crawl_vercel_results.json', JSON.stringify(ISSUES, null, 2));
  await browser.close();
})();
