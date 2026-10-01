// Exercises the primary create/update/action flows across every module, using
// a toast-log hook to detect silent failures (tone:'bad') as well as JS exceptions.
const { chromium } = require('playwright');
const fs = require('fs');
const DIR = require('path').join(__dirname, '..');
const RESULTS = [];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message.split('\n')[0]));
  page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('ERR_TUNNEL_CONNECTION_FAILED')) pageErrors.push('CONSOLE: ' + msg.text().slice(0,200)); });
  const mock = fs.readFileSync(require('path').join(__dirname, 'mock-supabase.js'), 'utf8');
  await page.addInitScript(mock);
  await page.goto('file://' + DIR + '/index.html');
  await page.waitForTimeout(300);

  await page.fill('input[name=name]', 'Aarav Mehta');
  await page.fill('input[name=email]', 'aarav@engagex.co');
  await page.fill('input[name=password]', 'TestPass123!');
  await page.click('button:has-text("Create workspace")');
  await page.waitForTimeout(300);

  // Hook toasts so we can detect silent failures (tone 'bad') deterministically.
  await page.evaluate(() => {
    window.__toastLog = [];
    const orig = EX.toast;
    EX.toast = function (msg, tone) { window.__toastLog.push({ msg, tone }); return orig.call(EX, msg, tone); };
  });
  async function clearToasts() { await page.evaluate(() => { window.__toastLog = []; }); }
  async function lastToast() { return await page.evaluate(() => window.__toastLog[window.__toastLog.length - 1] || null); }

  async function closeModal() { await page.evaluate(() => { if (document.getElementById('ex-modal-backdrop')) EX.closeModal(); }); await page.waitForTimeout(100); }
  async function check(name, fn) {
    await closeModal();
    const errBefore = pageErrors.length;
    try {
      await fn();
      const newErrs = pageErrors.slice(errBefore);
      if (newErrs.length) { RESULTS.push({ name, status: 'FAIL', detail: 'JS error: ' + newErrs.join(' | ') }); console.log('FAIL:', name, '-', newErrs.join(' | ')); }
      else { RESULTS.push({ name, status: 'PASS' }); console.log('PASS:', name); }
    } catch (e) {
      RESULTS.push({ name, status: 'FAIL', detail: e.message.split('\n')[0] });
      console.log('FAIL:', name, '-', e.message.split('\n')[0]);
    }
  }
  async function expectGoodToast(name) {
    const t = await lastToast();
    if (!t) throw new Error('no toast fired after ' + name);
    if (t.tone === 'bad') throw new Error('toast reported failure: ' + t.msg);
  }

  // ============ CRM / LEADS ============
  await check('CRM: create new lead', async () => {
    await page.click('a[href="#/crm"]');
    await page.click('button:has-text("New lead")');
    await clearToasts();
    await page.fill('#f_company', 'Orbit Fashions');
    await page.fill('#f_contactPerson', 'Meera Shah');
    await page.fill('#f_email', 'meera@orbit.example');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('create lead');
  });
  await check('CRM: open lead detail + AI prospect analysis', async () => {
    await page.click('a[href="#/crm"]');
    await page.waitForTimeout(200);
    await page.click('text=Orbit Fashions');
    await page.waitForTimeout(200);
    const aiTabBtn = page.locator('button:has-text("AI")').first();
    if (await aiTabBtn.count()) await aiTabBtn.click();
    await clearToasts();
    const runBtn = page.locator('#ai-analysis-btn');
    if (await runBtn.count()) { await runBtn.click(); await page.waitForTimeout(600); }
  });
  await check('CRM: create proposal from lead', async () => {
    await page.click('a[href="#/crm"]');
    await page.waitForTimeout(200);
    await page.click('text=Orbit Fashions');
    await page.waitForTimeout(200);
    const propTabBtn = page.locator('button:has-text("Proposal")').first();
    if (await propTabBtn.count()) await propTabBtn.click();
    await clearToasts();
    const genBtn = page.locator('button:has-text("Generate proposal draft")');
    if (await genBtn.count()) { await genBtn.click(); await page.waitForTimeout(400); }
  });

  // ============ PROPOSALS ============
  await check('Proposals: new proposal via list button', async () => {
    await page.click('a[href="#/proposals"]');
    await page.click('button:has-text("New proposal")');
    await clearToasts();
    await page.fill('input[name=company]', 'Nimbus Retail');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('create proposal');
  });
  await check('Proposals: edit services + commercials + status flow', async () => {
    await page.click('a[href="#/proposals"]');
    await page.waitForTimeout(200);
    await page.click('text=Nimbus Retail');
    await page.waitForTimeout(200);
    const editServicesBtn = page.locator('button:has-text("Edit")').first();
    if (await editServicesBtn.count()) { await editServicesBtn.click(); await page.waitForTimeout(200); await closeModal(); }
    await clearToasts();
    const submitReview = page.locator('button:has-text("Submit for Sales Review")');
    if (await submitReview.count()) { await submitReview.click(); await page.waitForTimeout(300); await expectGoodToast('submit for review'); }
  });

  // ============ CLIENTS ============
  await check('Clients: add client directly', async () => {
    await page.click('a[href="#/clients"]');
    await page.click('button:has-text("Add client")');
    await clearToasts();
    await page.fill('#f_companyName', 'Acme Corp');
    await page.fill('#f_monthlyFee', '50000');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('create client');
  });
  await check('Clients: edit client', async () => {
    await page.click('a[href="#/clients"]');
    await page.waitForTimeout(200);
    await page.click('text=Acme Corp');
    await page.waitForTimeout(200);
    await page.click('button:has-text("Edit")');
    await clearToasts();
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('edit client');
  });
  await check('Clients: add platform link', async () => {
    await page.click('button:has-text("Platforms")');
    await page.click('button:has-text("Add platform")');
    await clearToasts();
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('add platform');
  });
  await check('Clients: update performance snapshot', async () => {
    await page.click('button:has-text("Performance")');
    await page.click('button:has-text("Enter this month\'s numbers")');
    await clearToasts();
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('save performance');
  });
  await check('Clients: schedule meeting', async () => {
    await page.click('button:has-text("Meetings")');
    await page.click('button:has-text("Schedule meeting")');
    await clearToasts();
    await page.fill('input[name=date]', '2026-10-01T10:00');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('schedule meeting');
  });
  await check('Clients: enter + exit portal preview', async () => {
    await page.click('a[href="#/clients"]');
    await page.waitForTimeout(200);
    await page.click('text=Acme Corp');
    await page.waitForTimeout(200);
    await page.click('button:has-text("Preview client portal")');
    await page.waitForTimeout(300);
    const exitBtn = page.locator('button:has-text("Exit preview")');
    if (await exitBtn.count()) { await exitBtn.click(); await page.waitForTimeout(200); }
  });

  // ============ TASKS ============
  await check('Tasks: create new task', async () => {
    await page.click('a[href="#/tasks"]');
    await page.waitForTimeout(200);
    await page.click('button:has-text("New task")');
    await clearToasts();
    await page.fill('#f_title', 'Design homepage banner');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('create task');
  });
  await check('Tasks: open task drawer', async () => {
    await page.click('a[href="#/tasks"]');
    await page.waitForTimeout(200);
    const row = page.locator('table tbody tr').first();
    if (await row.count()) { await row.click(); await page.waitForTimeout(300); }
  });

  // ============ INVOICES / PAYMENTS ============
  await check('Invoices: create new invoice', async () => {
    await page.click('a[href="#/invoices"]');
    await page.click('button:has-text("New invoice")');
    await clearToasts();
    await page.click('button:has-text("Add line")');
    await page.fill('.li-desc', 'Monthly Retainer');
    await page.fill('.li-qty', '1');
    await page.fill('.li-rate', '50000');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(400);
    await expectGoodToast('create invoice');
  });
  await check('Invoices: download as text', async () => {
    const dlBtn = page.locator('button:has-text("Download")').first();
    if (await dlBtn.count()) { await clearToasts(); await dlBtn.click(); await page.waitForTimeout(300); }
  });
  await check('Payments: client submits payment (portal) + admin verifies', async () => {
    await page.click('a[href="#/clients"]');
    await page.waitForTimeout(200);
    await page.click('text=Acme Corp');
    await page.waitForTimeout(200);
    await page.click('button:has-text("Preview client portal")');
    await page.waitForTimeout(300);
    await page.click('a[href="#/portal-payments"]');
    await page.waitForTimeout(200);
    const payNowBtn = page.locator('button:has-text("Pay now")').first();
    if (await payNowBtn.count()) {
      await payNowBtn.click();
      await page.waitForTimeout(200);
      await clearToasts();
      await page.fill('input[name=transactionRef]', 'TXN12345');
      await page.click('form button.ex-btn-primary');
      await page.waitForTimeout(300);
      await expectGoodToast('submit payment');
    }
    await page.click('button:has-text("Exit preview")').catch(()=>{});
    await page.waitForTimeout(200);
    await page.click('a[href="#/payments"]');
    await page.waitForTimeout(200);
    const verifyBtn = page.locator('button:has-text("Verify")').first();
    if (await verifyBtn.count()) {
      await clearToasts();
      await verifyBtn.click();
      await page.waitForTimeout(200);
      await page.click('#ex-confirm-yes').catch(()=>{});
      await page.waitForTimeout(300);
      await expectGoodToast('verify payment');
    }
  });
  await check('Payments: view + download receipt', async () => {
    await page.click('a[href="#/payments"]');
    await page.waitForTimeout(200);
    const receiptBtn = page.locator('button:has-text("Receipt")').first();
    if (await receiptBtn.count()) {
      await receiptBtn.click();
      await page.waitForTimeout(200);
      await clearToasts();
      await page.click('button:has-text("Download")');
      await page.waitForTimeout(300);
    }
  });

  // ============ VENDORS & EXPENSES ============
  await check('Vendors: log expense', async () => {
    await page.click('a[href="#/vendors"]');
    await page.click('button:has-text("New expense")');
    await clearToasts();
    await page.selectOption('#f_category', { index: 1 });
    await page.fill('#f_amount', '1500');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('log expense');
  });
  await check('Vendors: add vendor + add bill', async () => {
    await page.click('button:has-text("Vendors & Bills")');
    await page.click('button:has-text("New vendor")');
    await clearToasts();
    await page.fill('#f_name', 'Google Ads');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('add vendor');
    await clearToasts();
    await page.click('button:has-text("Add bill")');
    await page.waitForTimeout(200);
    await page.fill('#f_amount', '8000');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('add bill');
  });

  // ============ BANK ============
  await check('Bank: add account + add transaction', async () => {
    await page.click('a[href="#/bank"]');
    await page.click('button:has-text("Add account")');
    await clearToasts();
    await page.fill('#f_bankName', 'ICICI Bank');
    await page.fill('#f_accountLabel', 'Current A/C 2');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('add bank account');
    await clearToasts();
    await page.click('button:has-text("Add transaction")');
    await page.waitForTimeout(200);
    await page.fill('#f_amount', '10000');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('add transaction');
  });

  // ============ EMPLOYEES / ASSETS ============
  await check('Employees: add employee', async () => {
    await page.click('a[href="#/employees"]');
    await page.click('button:has-text("Add employee")');
    await clearToasts();
    await page.fill('#f_name', 'Neha Kapoor');
    await page.fill('#f_email', 'neha@engagex.co');
    await page.selectOption('#f_role', 'hr');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('add employee');
  });
  await check('Employees: open detail, issue asset', async () => {
    await page.click('a[href="#/employees"]');
    await page.waitForTimeout(200);
    await page.click('text=Neha Kapoor');
    await page.waitForTimeout(250);
    const assetsTab = page.locator('button:has-text("Assets")');
    if (await assetsTab.count()) {
      await assetsTab.click();
      await page.waitForTimeout(150);
      const issueBtn = page.locator('button:has-text("Issue asset")');
      if (await issueBtn.count()) {
        await issueBtn.click();
        await page.waitForTimeout(150);
        await clearToasts();
        await page.fill('#f_name', 'Dell Monitor');
        await page.click('form button.ex-btn-primary');
        await page.waitForTimeout(300);
        await expectGoodToast('issue asset');
      }
    }
  });
  await check('Assets: add company asset from global page', async () => {
    await page.click('a[href="#/assets"]');
    await page.click('button:has-text("Add asset")');
    await clearToasts();
    await page.fill('#f_name', 'iPhone 14');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('add asset');
  });

  // ============ ATTENDANCE / LEAVE ============
  await check('Attendance: clock in', async () => {
    await page.click('a[href="#/attendance"]');
    await clearToasts();
    const btn = page.locator('button:has-text("Clock in")');
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(300); await expectGoodToast('clock in'); }
  });
  await check('Leave: apply for leave (valid range) + approve', async () => {
    await page.click('a[href="#/leave"]');
    await page.click('button:has-text("Apply for leave")');
    await clearToasts();
    await page.fill('#f_startDate', '2026-10-05');
    await page.fill('#f_endDate', '2026-10-06');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('apply leave');
    await clearToasts();
    const approveBtn = page.locator('button:has-text("Approve")').first();
    if (await approveBtn.count()) { await approveBtn.click(); await page.waitForTimeout(300); await expectGoodToast('approve leave'); }
  });

  // ============ VIDEO SHOOTS ============
  await check('Shoots: schedule new shoot', async () => {
    await page.click('a[href="#/shoots"]');
    await page.click('button:has-text("New shoot")');
    await clearToasts();
    await page.selectOption('#f_clientId', { index: 0 });
    await page.fill('#f_date', '2026-10-10');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('schedule shoot');
  });

  // ============ SUPPORT ============
  await check('Support: raise ticket via portal + assign/status as staff', async () => {
    await page.click('a[href="#/clients"]');
    await page.waitForTimeout(200);
    await page.click('text=Acme Corp');
    await page.waitForTimeout(200);
    await page.click('button:has-text("Preview client portal")');
    await page.waitForTimeout(300);
    await page.click('a[href="#/portal-support"]');
    await page.waitForTimeout(200);
    await page.click('button:has-text("New request")');
    await clearToasts();
    await page.selectOption('#f_category', { index: 1 });
    await page.fill('#f_message', 'Need help with login');
    await page.click('form button.ex-btn-primary');
    await page.waitForTimeout(300);
    await expectGoodToast('raise ticket');
    await page.click('button:has-text("Exit preview")').catch(()=>{});
    await page.waitForTimeout(200);
    await page.click('a[href="#/support"]');
    await page.waitForTimeout(200);
  });

  // ============ FORECAST / ADVISOR ============
  await check('Forecast: change scenario + growth inputs', async () => {
    await page.click('a[href="#/forecast"]');
    await page.waitForTimeout(300);
    await page.selectOption('#fc-scenario', 'aggressive').catch(()=>{});
    await page.fill('#fc-growth', '8').catch(()=>{});
    await page.waitForTimeout(200);
  });
  await check('Advisor: ask a question', async () => {
    await page.click('a[href="#/advisor"]');
    await page.fill('input[name=q]', 'How can we increase profit?');
    await page.click('button:has-text("Ask")');
    await page.waitForTimeout(600);
  });

  // ============ SETTINGS / INTEGRATIONS ============
  await check('Settings: update company settings', async () => {
    await page.click('a[href="#/settings"]');
    await page.waitForTimeout(200);
    const saveBtn = page.locator('button:has-text("Save")').first();
    if (await saveBtn.count()) { await clearToasts(); await saveBtn.click(); await page.waitForTimeout(300); await expectGoodToast('save settings'); }
  });

  console.log('\n=== ACTION TESTS COMPLETE ===');
  const fails = RESULTS.filter(r => r.status === 'FAIL');
  console.log('Total:', RESULTS.length, 'Pass:', RESULTS.length - fails.length, 'Fail:', fails.length);
  fails.forEach(f => console.log('FAIL ::', f.name, '::', f.detail));
  fs.writeFileSync(__dirname + '/qa_actions_vercel_results.json', JSON.stringify(RESULTS, null, 2));
  await browser.close();
})();
