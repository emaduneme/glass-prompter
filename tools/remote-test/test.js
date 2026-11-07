// End-to-end test of the web page's remote: a local PeerServer, the page
// served from this repository, and three browsers (a computer and two iPads).
// Run: npm ci && npx playwright install chromium && npm test
const http = require('http'), fs = require('fs'), path = require('path');
const { PeerServer } = require('peer');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

(async () => {
  PeerServer({ port: 9000, path: '/', host: '127.0.0.1' });
  http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(8123, '127.0.0.1');
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const init = () => { window.GP_PEER = { host: '127.0.0.1', port: 9000, path: '/', secure: false, config: { iceServers: [] } }; };
  const pc = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const ipad = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await pc.addInitScript(init); await ipad.addInitScript(init);
  const errors = [];

  let A = await pc.newPage();
  A.on('pageerror', (e) => errors.push('A ' + e.message));
  await A.goto('http://127.0.0.1:8123/?mode=controller');
  await A.waitForFunction(() => /No display yet/.test(document.getElementById('linkText').textContent), null, { timeout: 15000 });
  const code = (await A.textContent('#pairCode')).replace(/\s/g, '');
  ok(/^[A-Z2-9]{6}$/.test(code), `computer shows a pair code (${code})`);
  ok(await A.locator('#pairQr svg').count() === 1, 'computer shows a QR code');
  ok(!/\?/.test(A.url()), 'mode and code are removed from the address bar');
  await A.screenshot({ path: `${SHOTS}/computer-waiting.png` });

  // iPad opens the QR link.
  const B = await ipad.newPage();
  B.on('pageerror', (e) => errors.push('B ' + e.message));
  await B.goto(`http://127.0.0.1:8123/?mode=display&pair=${code}`);
  await B.waitForFunction(() => !document.getElementById('stage').hidden && document.getElementById('waiting').hidden && document.getElementById('text').textContent.includes('Sample script'), null, { timeout: 15000 });
  ok(true, 'iPad opened the prompter and received the script');
  await A.waitForFunction(() => /iPad display connected/.test(document.getElementById('linkText').textContent), null, { timeout: 10000 });
  ok(true, 'computer sees the iPad');
  ok(await A.locator('#pairBox.linked').count() === 1, 'QR code hides once paired');

  // Play from the computer; the iPad scrolls and reports progress back.
  await A.waitForFunction(() => !document.getElementById('tPlay').disabled, null, { timeout: 10000 });
  await A.click('#tPlay');
  await A.waitForFunction(() => parseFloat(document.getElementById('liveBar').style.width) > 0, null, { timeout: 15000 });
  ok(true, 'Play on the computer scrolls the iPad, and progress comes back');
  await A.waitForFunction(() => !/reading marker shows here/.test(document.getElementById('liveLine').textContent), null, { timeout: 10000 });
  ok(true, 'computer shows the line on the iPad reading marker');
  await A.screenshot({ path: `${SHOTS}/computer-paired.png` });
  await B.screenshot({ path: `${SHOTS}/ipad-prompter.png` });
  await A.click('#tPlay');

  // Edit the script on the computer; the iPad follows.
  await A.fill('#script', 'Hello from the computer.\n\nSecond paragraph here.');
  await B.waitForFunction(() => document.getElementById('text').textContent.includes('Hello from the computer'), null, { timeout: 10000 });
  ok(true, 'script edits reach the iPad');

  // The computer reloads (it held the code). The link comes back.
  await A.close();
  A = await pc.newPage();
  A.on('pageerror', (e) => errors.push('A2 ' + e.message));
  await A.goto('http://127.0.0.1:8123/');
  ok((await A.textContent('#pairCode')).replace(/\s/g, '') === code, 'computer keeps its code after a reload');
  await A.waitForFunction(() => /iPad display connected/.test(document.getElementById('linkText').textContent), null, { timeout: 30000 });
  ok(true, 'link comes back after the computer reloads');

  // A second iPad types the code by hand.
  const ipad2 = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  await ipad2.addInitScript(init);
  const C = await ipad2.newPage();
  C.on('pageerror', (e) => errors.push('C ' + e.message));
  await C.goto('http://127.0.0.1:8123/');
  await C.click('#mode-display');
  await C.waitForSelector('#pairInput', { state: 'visible' });
  await C.screenshot({ path: `${SHOTS}/ipad-enter-code.png` });
  await C.fill('#pairInput', code.slice(0, 3).toLowerCase() + ' ' + code.slice(3).toLowerCase());
  await C.press('#pairInput', 'Enter');
  await C.waitForFunction(() => !document.getElementById('stage').hidden && document.getElementById('text').textContent.includes('Hello from the computer'), null, { timeout: 15000 });
  ok(true, 'typed code (lower case, with a space) pairs a second iPad');
  await A.waitForFunction(() => /2 displays connected/.test(document.getElementById('linkText').textContent), null, { timeout: 10000 });
  ok(true, 'computer sees both iPads');

  ok(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
