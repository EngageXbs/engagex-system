// Exercises the REAL same-origin /api/ai path (impossible to test from a file://
// page, since browsers correctly CORS-block a relative fetch there) by serving the
// export over plain HTTP with api/ai.js mounted, exactly like Vercel would route it.
// Without ANTHROPIC_API_KEY set, api/ai.js should return a clean 503 and the app
// should show a friendly inline message rather than crashing — this proves the
// "AI gracefully turns itself off without a key" behavior promised in the README.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');

(async () => {
  delete process.env.ANTHROPIC_API_KEY; // simulate a deployment with no key configured yet
  const server = require('./local-server.js');
  await new Promise((r) => setTimeout(r, 300));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const pageErrors = [];
  const corsErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /CORS|blocked/i.test(msg.text())) corsErrors.push(msg.text());
  });

  const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
  await page.addInitScript(mock);
  await page.goto('http://localhost:' + (process.env.PORT || 8934) + '/index.html');
  await page.waitForTimeout(500);

  await page.fill('input[name=name]', 'Aarav Mehta');
  await page.fill('input[name=email]', 'aarav@engagex.co');
  await page.fill('input[name=password]', 'TestPass123!');
  await page.click('button:has-text("Create workspace")');
  await page.waitForTimeout(400);

  await page.click('a[href="#/advisor"]');
  await page.fill('input[name=q]', 'How can we increase profit?');
  await page.click('button:has-text("Ask")');
  await page.waitForTimeout(800);

  const logText = await page.evaluate(() => document.getElementById('advisor-log').innerText);
  console.log('Advisor log after asking with no API key configured:\n---\n' + logText + '\n---');

  let ok = true;
  if (corsErrors.length) { console.log('FAIL: got CORS errors on same-origin /api/ai fetch:', corsErrors); ok = false; }
  if (pageErrors.length) { console.log('FAIL: uncaught JS errors:', pageErrors); ok = false; }
  if (!/not configured|AI features are unavailable|AI request failed/i.test(logText)) {
    console.log('FAIL: expected a friendly "AI not configured" message in the advisor log, got:', logText);
    ok = false;
  }
  console.log(ok ? '\nPASS: same-origin /api/ai reachable, and missing-key case degrades gracefully with no crash.' : '\nFAIL: see above.');

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
})();
