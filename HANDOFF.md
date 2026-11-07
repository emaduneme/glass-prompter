# Handoff: redesign the Glass Prompter Desktop editor

Saved 2026-10-26 for the next session. Branch: `claude/desktop-app`.

**Status: done on 2026-10-26.** The editor now has four tabs (Read, Look, Screens, Share), info buttons, a Shortcuts sheet (F1), and accessibility tests (`test/e2e/a11y.spec.js`, `test/unit/contrast.test.js`). The "Other open items" at the end are still open.

## The ask (from Emmanuel)

> The Windows app has a lot of text. Remove all of that text. Design it using the Gestalt principles of psychology, and use design principles to clean up the text and make it easy to navigate, including WCAG accessibility.

He likes the app. This is a visual and copy pass, not new features.

## Where the text is

All in the editor window (`desktop/src/renderer/editor/`). The prompter overlay is already lean.

| Place | File | What's there now |
|---|---|---|
| Settings notes | `editor.js`, `TABS` schema (`note:` on 7 fields) | A sentence under most controls: mode descriptions, overlay descriptions, screen-share note, follow-cursor note, remote-button mapping (very long). |
| Custom panels | `editor.js`, `CUSTOM.model`, `mic`, `displaysNote`, `remote`, `director` | Paragraphs about the model download and privacy, Wi-Fi, director security, display count. |
| Script hint | `index.html` line ~45 | "Words in [square brackets] show dimmed…" |
| Keyboard line | `index.html` line ~65 | Long shortcut sentence under the Start button. |
| Banner | `editor.js`, `start()` | Model-download prompt. Fine, but check the wording. |
| Director cover | `index.html` | Heading, paragraph, QR, URL. |

## Design direction

**Remove text by default; reveal it on demand.**
- Replace descriptive notes with a short label plus an info button (`ⓘ`) that opens a popover or `<details>`. Keep one-line notes only where a wrong choice is costly (security, mic privacy).
- Move the keyboard and remote mappings into one "Shortcuts" sheet (a `?` button or `F1`), not inline.
- Change the remote-button paragraph into a small table inside that sheet.

**Gestalt principles to apply**
- **Proximity:** a label sits next to its control; more space between groups than inside them. Use one spacing scale (4/8/12/16/24).
- **Common region:** one card per task (Mode, Look, Screens, Share). No nested cards.
- **Similarity:** the same control type always looks the same. The same accent color means "selected" everywhere and nothing else.
- **Figure-ground:** the script and the Start button are the figure; settings recede (lower contrast surface, smaller type).
- **Focal point:** one primary action per screen (Start / Stop). Everything else is secondary or ghost.
- **Continuity:** one reading path, left to right: Pages → Script → Settings. Align everything to one grid.
- **Prägnanz:** the simplest form wins. Icons with labels over prose. Hide controls that don't apply (this is already done with `show:`).
- **Common fate:** controls that change together (for example, mode and its speed) animate and appear together.

**Navigation**
- Consider fewer tabs, named by goal: *Read* (mode, speed, mic, model), *Look* (type, color, overlay), *Screens* (second display, mirror), *Share* (remote, director). Today there are 5 tabs.
- Make the tabs a real ARIA `tablist`: arrow keys move between tabs, and `aria-controls` / `tabpanel` are wired up.

**WCAG 2.2 AA checklist**
- Contrast: body text 4.5:1, large text and UI parts 3:1, in light and dark. Check `--muted` on `--surface` in both themes (likely borderline).
- Focus: visible focus on every control (2.4.7), not hidden by sticky elements (2.4.11).
- Target size: at least 24×24 px (2.5.8). The page delete `×` (22 px) and the overlay buttons (28 px) need checking.
- Labels: every input has an accessible name. The segmented radios need a `fieldset` / `legend` or `aria-labelledby`.
- Status messages (download progress, errors, banner) use `role="status"` / `aria-live` (4.1.3).
- No information by color alone: the reading dot, the dirty-file dot and the swatches need a text alternative.
- Reduced motion is respected (already in CSS; keep it).
- Keyboard: everything reachable, logical tab order, Esc closes popovers.
- Text resize to 200% without loss (1.4.4); the 340 px settings column must reflow.

## How to verify

```bash
cd desktop
npm ci
npm test
xvfb-run -a -s "-screen 0 1920x1080x24" npm run test:e2e   # on Linux; screenshots land in test-results/screenshots
```

- Check the screenshots of every tab before and after.
- Add an automated accessibility check: `@axe-core/playwright` on the editor in the e2e suite, with zero serious violations.
- E2E selectors use `#tabs button` with tab names and `.qr img`. Update them if tabs are renamed.
- After pushing, the workflow rebuilds the installers on the [desktop-latest release](https://github.com/emaduneme/glass-prompter/releases/tag/desktop-latest). Confirm the build is green and the files are there before reporting done.

## Done means

- The editor reads as calm: no paragraph text visible by default, except safety-critical one-liners.
- Every removed explanation is still one click away.
- axe shows no serious violations; contrast is checked in both themes.
- Before and after screenshots of each tab are shown to Emmanuel.

## Other open items

- `claude/desktop-app` is not merged to `main` yet, so the README's download link isn't on the repo's front page.
- The web page (`index.html`) still offers "Remote control" and "Display" modes that tell people to sign in to claude.ai. That version is retired; remove the modes or point them to the desktop app.
- Emmanuel prefers short sentences, no em dashes, and plain language (ASD-STE100 style) in anything he reads.
