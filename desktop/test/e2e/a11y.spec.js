'use strict';

// Accessibility checks on the editor window: axe-core on every settings tab
// in light and dark, plus the WCAG 2.2 points axe cannot see on its own
// (tab keys, Esc, target size, calm default view).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const APP = path.join(__dirname, '..', '..');
const SHOTS = path.join(APP, 'test-results', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const TABS = ['Read', 'Look', 'Screens', 'Share'];

let app;
let editor;

test.beforeEach(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'glassprompter-a11y-'));
  const args = [APP, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (process.getuid && process.getuid() === 0) args.push('--no-sandbox');
  app = await _electron.launch({
    args,
    env: { ...process.env, GLASS_PROMPTER_TEST: '1', GLASS_PROMPTER_FAKE_SPEECH: '1', GLASS_PROMPTER_USER_DATA: userData },
  });
  editor = await app.firstWindow();
  await editor.waitForSelector('#tabs [role=tab]');
  await editor.waitForFunction(() => document.getElementById('stats').textContent.length > 0);
});

test.afterEach(async () => {
  if (app) await app.close();
  app = null;
});

// Electron cannot open the extra page axe uses for frames, so run it in the page.
const axe = () => new AxeBuilder({ page: editor })
  .setLegacyMode(true)
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
  .analyze();
const serious = (result) => result.violations
  .filter((v) => v.impact === 'serious' || v.impact === 'critical')
  .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test('axe finds no serious violations on any tab, in light and dark', async () => {
  // Turn on the network features so the Share tab shows its QR codes too.
  await app.evaluate(() => global.glassPrompter.settings.set({ browserServerEnabled: true, browserServerPort: 17393 }));
  await expect.poll(() => app.evaluate(() => global.glassPrompter.lanStatus().remote.running)).toBe(true);
  for (const theme of ['light', 'dark']) {
    await editor.emulateMedia({ colorScheme: theme });
    for (const [i, tab] of TABS.entries()) {
      await editor.locator('#tabs [role=tab]', { hasText: tab }).click();
      await expect(editor.locator('#panels .card').first()).toBeVisible();
      expect(serious(await axe()), `${tab} tab, ${theme}`).toEqual([]);
      await editor.screenshot({ path: path.join(SHOTS, `a11y-${theme}-${i + 1}-${tab.toLowerCase()}.png`) });
    }
    // Every tip open at once, and the Shortcuts sheet.
    for (const btn of await editor.locator('.info').all()) {
      if (await btn.getAttribute('aria-expanded') === 'false') await btn.click();
    }
    expect(serious(await axe()), `tips open, ${theme}`).toEqual([]);
    await editor.keyboard.press('F1');
    await expect(editor.locator('#shortcuts')).toBeVisible();
    expect(serious(await axe()), `shortcuts, ${theme}`).toEqual([]);
    await editor.screenshot({ path: path.join(SHOTS, `a11y-${theme}-shortcuts.png`) });
    await editor.keyboard.press('Escape');
    await expect(editor.locator('#shortcuts')).toBeHidden();
  }
});

test('settings tabs follow the ARIA tabs pattern', async () => {
  const tabs = editor.locator('#tabs [role=tab]');
  await expect(editor.locator('#tabs')).toHaveAttribute('role', 'tablist');
  await tabs.first().click();
  await expect(editor.locator('#panels')).toHaveAttribute('aria-labelledby', 'tab-read');
  await expect(tabs.first()).toHaveAttribute('aria-controls', 'panels');
  // Only the selected tab is in the Tab order.
  await expect(editor.locator('#tabs [tabindex="0"]')).toHaveCount(1);

  await editor.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(editor.locator('#panels')).toHaveAttribute('aria-labelledby', 'tab-look');
  await editor.keyboard.press('End');
  await expect(tabs.nth(3)).toBeFocused();
  await editor.keyboard.press('ArrowRight');
  await expect(tabs.nth(0)).toBeFocused();
  await editor.keyboard.press('ArrowLeft');
  await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  await editor.keyboard.press('Home');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('the default view is calm: no explanations until asked', async () => {
  for (const tab of TABS) {
    await editor.locator('#tabs [role=tab]', { hasText: tab }).click();
    await expect(editor.locator('.tip:visible')).toHaveCount(0);
  }
  // Only safety lines stay visible: the Director Mode warning.
  await expect(editor.locator('.note.warn')).toHaveText('Not encrypted. Use only on networks you trust.');

  // An info button opens its tip and Esc closes it again.
  await editor.locator('#tabs [role=tab]', { hasText: 'Read' }).click();
  const info = editor.locator('.info[aria-controls="tip-listeningMode"]');
  await info.click();
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  await expect(editor.locator('#tip-listeningMode')).toContainText('Word Tracking follows your voice');
  await editor.keyboard.press('Escape');
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await expect(editor.locator('#tip-listeningMode')).toBeHidden();
  await expect(info).toBeFocused();
});

test('changing a setting keeps keyboard focus on the control', async () => {
  await editor.locator('#tabs [role=tab]', { hasText: 'Read' }).click();
  const classic = editor.locator('input[data-k="listeningMode:classic"]');
  await classic.focus();
  await editor.keyboard.press('Space');
  await expect.poll(() => app.evaluate(() => global.glassPrompter.settings.get('listeningMode'))).toBe('classic');
  await expect(classic).toBeFocused();
  // The speed slider appears with the mode that uses it.
  await expect(editor.locator('#f-scrollSpeed')).toBeVisible();
  await expect(editor.locator('#f-scrollSpeed')).toHaveAttribute('aria-valuetext', /words\/s$/);
});

test('every visible control is at least 24 by 24 pixels', async () => {
  // Two pages, so the delete buttons render too.
  await editor.locator('#add-page').click();
  for (const tab of TABS) {
    await editor.locator('#tabs [role=tab]', { hasText: tab }).click();
    const problems = await editor.evaluate(() => {
      const out = [];
      const targets = document.querySelectorAll('button, select, input, textarea, [role=tab]');
      for (const node of targets) {
        if (!node.checkVisibility()) continue;
        // A visually hidden radio or checkbox uses its label as the target.
        const hit = node.matches('input[type=radio], input[type=checkbox]') ? node.closest('label') : node;
        const r = hit.getBoundingClientRect();
        const name = node.labels?.[0]?.textContent || node.getAttribute('aria-label') || node.textContent || node.id;
        if (r.width < 24 || r.height < 24) out.push(`${name.trim()} is ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return out;
    });
    expect(problems, tab).toEqual([]);
  }
});

test('the Shortcuts sheet opens from the ? button and returns focus', async () => {
  const btn = editor.locator('#btn-keys');
  await btn.click();
  const dialog = editor.locator('#shortcuts');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h3')).toHaveText(['Editor', 'While reading', 'Remote']);
  await expect(dialog.locator('#keys-remote tbody tr')).toHaveCount(4);
  await editor.locator('#shortcuts-close').click();
  await expect(dialog).toBeHidden();
  await expect(btn).toBeFocused();
});

test('the editor reflows at 200% zoom without sideways scrolling', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await expect.poll(() => editor.evaluate(() => window.innerWidth)).toBeLessThan(700);
  const layout = await editor.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pastEdge: [...document.querySelectorAll('body *')].filter((n) => n.getBoundingClientRect().right > window.innerWidth + 1).length,
  }));
  expect(layout).toEqual({ overflow: 0, pastEdge: 0 });
  await expect(editor.locator('#btn-start')).toBeVisible();
  await expect(editor.locator('#tabs')).toBeVisible();
  // Playwright's screenshot crops a zoomed Electron page, so ask Electron.
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(SHOTS, 'a11y-zoom-200.png'), Buffer.from(png, 'base64'));
});
