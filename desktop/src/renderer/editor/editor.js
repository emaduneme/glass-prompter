'use strict';

(() => {
  const api = window.glassPrompter;
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c) node.append(c);
    return node;
  };

  let state = null;
  let s = {};
  let doc = { pages: [''], currentPageIndex: 0 };
  let reading = { active: false };
  let activeTab = 'read';
  let mics = [];
  let downloadErrors = {};
  let mod = 'Ctrl';
  const openTips = new Set();

  const COLORS = {
    white: '#ffffff', yellow: 'rgb(255,214,10)', green: 'rgb(51,214,74)',
    blue: 'rgb(79,140,255)', pink: 'rgb(255,97,145)', orange: 'rgb(255,158,10)',
  };
  const colorName = (v) => (v ? v[0].toUpperCase() + v.slice(1) : '');

  // Tip text: one short sentence per choice, shown only when asked for.
  const lines = (rows) => rows.map(([name, text]) => el('p', {}, [el('b', { text: name }), ` ${text}`]));
  const MODE_TIP = () => lines([
    ['Word Tracking', 'follows your voice and highlights each word. It runs offline on this computer.'],
    ['Classic', 'scrolls at a steady speed. It needs no microphone.'],
    ['Voice-Activated', 'scrolls while you speak and pauses when you stop.'],
  ]);
  const OVERLAY_TIP = () => lines([
    ['Pinned', 'is a bar at the top center of the screen, under the webcam. It stays above all apps.'],
    ['Floating', 'is a window you can drag anywhere. It stays on top.'],
    ['Fullscreen', 'fills the display you pick. Press Esc to stop.'],
  ]);
  const SCREEN_TIP = () => [
    ...lines([
      ['Teleprompter', 'shows a fullscreen prompter on the display you pick.'],
      ['Mirror', 'does the same, flipped for teleprompter glass.'],
    ]),
    el('p', { text: 'An iPad or phone works too. Use Share, or wireless display on Windows, or Sidecar on a Mac.' }),
  ];
  const AXIS_TIP = () => lines([
    ['Horizontal', 'flips left to right. This is the standard for mirror rigs.'],
    ['Vertical', 'flips top to bottom.'],
    ['Both', 'turns the text 180°.'],
  ]);

  // ---------------------------------------------------------------- settings schema
  // Four tabs named by goal. Each card holds one task. `show` hides fields
  // that do not apply; `info` puts the explanation behind an info button.

  const displayOptions = (autoLabel) => [[0, autoLabel], ...(state ? state.displays.map((d) => [d.id, d.label]) : [])];

  const TABS = [
    { id: 'read', label: 'Read', cards: [
      { id: 'guidance', title: 'Guidance', fields: [
        { key: 'listeningMode', type: 'seg', label: 'Mode', options: [['wordTracking', 'Word Tracking'], ['classic', 'Classic'], ['silencePaused', 'Voice-Activated']], info: MODE_TIP },
        { key: 'scrollSpeed', type: 'range', label: 'Speed', min: 0.5, max: 8, step: 0.5, fmt: (v) => `${v.toFixed(1)} words/s`, show: () => s.listeningMode !== 'wordTracking' },
        { custom: 'model', show: () => s.listeningMode === 'wordTracking' },
        { custom: 'mic', show: () => s.listeningMode !== 'classic' },
      ] },
      { id: 'flow', title: 'While reading', fields: [
        { key: 'autoNextPage', type: 'check', label: 'Go to the next page by itself' },
        { key: 'autoNextPageDelay', type: 'seg', label: 'Countdown', options: [[0, 'None'], [1, '1 s'], [3, '3 s'], [5, '5 s']], show: () => s.autoNextPage },
        { key: 'keepScreenAwake', type: 'check', label: 'Keep the screen awake' },
        { key: 'remoteControl', type: 'check', label: 'Remote and media keys', info: () => [
          el('p', { text: 'Pair the remote with this computer first.' }),
          el('button', { class: 'small', type: 'button', text: 'Show the buttons', 'data-k': 'remote-map', onclick: () => openShortcuts('keys-remote') }),
        ] },
      ] },
    ] },
    { id: 'look', label: 'Look', cards: [
      { id: 'overlay', title: 'Overlay', fields: [
        { key: 'overlayMode', type: 'seg', label: 'Show as', options: [['pinned', 'Pinned'], ['floating', 'Floating'], ['fullscreen', 'Fullscreen']], info: OVERLAY_TIP },
        { key: 'notchDisplayMode', type: 'seg', label: 'Screen', options: [['followMouse', 'Follow mouse'], ['fixedDisplay', 'Fixed']], show: () => s.overlayMode === 'pinned' },
        { key: 'pinnedScreenID', type: 'select', label: 'Display', options: () => displayOptions('Main display'), show: () => s.overlayMode === 'pinned' && s.notchDisplayMode === 'fixedDisplay' },
        { key: 'overlayTransparency', type: 'check', label: 'See-through background', show: () => s.overlayMode === 'pinned' },
        { key: 'overlayTransparencyOpacity', type: 'range', label: 'Transparency', min: 0, max: 0.8, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, show: () => s.overlayMode === 'pinned' && s.overlayTransparency },
        { key: 'floatingGlassEffect', type: 'check', label: 'Glass effect', show: () => s.overlayMode === 'floating' },
        { key: 'glassOpacity', type: 'range', label: 'Glass tint', min: 0, max: 0.6, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, show: () => s.overlayMode === 'floating' && s.floatingGlassEffect },
        { key: 'followCursorWhenUndocked', type: 'check', label: 'Follow the mouse pointer', show: () => s.overlayMode === 'floating', info: () => `The window moves with your pointer and ignores clicks. Pages go forward by themselves. To stop, press ${mod}+Shift+. (period).` },
        { key: 'fullscreenScreenID', type: 'select', label: 'Display', options: () => displayOptions('Display under the mouse'), show: () => s.overlayMode === 'fullscreen' },
        { key: 'notchWidth', type: 'range', label: 'Width', min: 310, max: 500, step: 5, fmt: (v) => `${Math.round(v)} px`, show: () => s.overlayMode !== 'fullscreen' },
        { key: 'textAreaHeight', type: 'range', label: 'Text height', min: 100, max: 400, step: 5, fmt: (v) => `${Math.round(v)} px`, show: () => s.overlayMode !== 'fullscreen' },
        { key: 'hideFromScreenShare', type: 'check', label: 'Hide from screen sharing', info: () => 'Zoom, Teams, OBS, recordings and screenshots do not see the prompter. Works on macOS and on Windows 10 version 2004 or later.' },
      ] },
      { id: 'text', title: 'Text', fields: [
        { key: 'fontFamilyPreset', type: 'seg', label: 'Typeface', options: [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono'], ['dyslexia', 'Dyslexia']] },
        { key: 'fontSizePreset', type: 'seg', label: 'Size', options: [['xs', 'XS'], ['sm', 'SM'], ['lg', 'LG'], ['xl', 'XL']] },
        { key: 'fontColorPreset', type: 'swatches', label: 'Highlight color' },
        { key: 'cueColorPreset', type: 'swatches', label: 'Cue color' },
        { key: 'cueBrightness', type: 'seg', label: 'Cue brightness', options: [['dim', 'Dim'], ['low', 'Low'], ['medium', 'Medium'], ['bright', 'Bright']] },
        { key: 'readingPosition', type: 'seg', label: 'Reading line', options: [['centered', 'Centered'], ['nearTop', 'Near top']] },
        { key: 'fullscreenFontScale', type: 'range', label: 'Fullscreen scale', min: 1, max: 4, step: 0.25, fmt: (v) => `${v.toFixed(2)}×` },
      ] },
      { id: 'show', title: 'Show', fields: [
        { key: 'showParagraphDividers', type: 'check', label: 'Paragraph dividers' },
        { key: 'showLastSpokenWords', type: 'check', label: 'Last words heard', show: () => s.listeningMode === 'wordTracking' },
        { key: 'showElapsedTime', type: 'check', label: 'Elapsed time' },
      ] },
    ] },
    { id: 'screens', label: 'Screens', cards: [
      { id: 'second', title: 'Second display', aside: () => `${state.displays.length} connected`, fields: [
        { key: 'externalDisplayMode', type: 'seg', label: 'Output', options: [['off', 'Off'], ['teleprompter', 'Teleprompter'], ['mirror', 'Mirror']], info: SCREEN_TIP },
        { key: 'externalScreenID', type: 'select', label: 'Display', options: () => displayOptions('First other display'), show: () => s.externalDisplayMode !== 'off' },
        { key: 'mirrorAxis', type: 'seg', label: 'Mirror axis', options: [['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['both', 'Both']], show: () => s.externalDisplayMode === 'mirror', info: AXIS_TIP },
      ] },
    ] },
    { id: 'share', label: 'Share', cards: [
      { id: 'remote', title: 'Phones and tablets', fields: [{ custom: 'remote' }] },
      { id: 'director', title: 'Director Mode', fields: [{ custom: 'director' }] },
    ] },
  ];

  // Tab ids from earlier versions.
  const OLD_TABS = { guidance: 'read', overlay: 'look', type: 'look', displays: 'screens', remote: 'share' };
  try { activeTab = localStorage.getItem('glassprompter.tab') || activeTab; } catch (e) { /* storage blocked */ }
  activeTab = OLD_TABS[activeTab] || activeTab;
  if (!TABS.some((t) => t.id === activeTab)) activeTab = TABS[0].id;

  // ---------------------------------------------------------------- info tips

  function setTip(btn, open) {
    btn.setAttribute('aria-expanded', String(open));
    const tip = $(btn.getAttribute('aria-controls'));
    if (tip) tip.hidden = !open;
    if (btn.dataset.tip) {
      if (open) openTips.add(btn.dataset.tip);
      else openTips.delete(btn.dataset.tip);
    }
  }

  function infoButton(id, label) {
    const btn = el('button', {
      class: 'info',
      type: 'button',
      text: 'i',
      'aria-label': `About ${label}`,
      'aria-expanded': String(openTips.has(id)),
      'aria-controls': `tip-${id}`,
      'data-tip': id,
      'data-k': `info:${id}`,
    });
    btn.addEventListener('click', () => setTip(btn, btn.getAttribute('aria-expanded') !== 'true'));
    return btn;
  }

  function tipNode(id, content) {
    const box = el('div', { class: 'tip', id: `tip-${id}` }, typeof content === 'string' ? el('p', { text: content }) : content);
    box.hidden = !openTips.has(id);
    return box;
  }

  $('script-info').addEventListener('click', (e) => setTip(e.currentTarget, e.currentTarget.getAttribute('aria-expanded') !== 'true'));

  // ---------------------------------------------------------------- render settings

  function set(patch) {
    Object.assign(s, patch);
    api.setSettings(patch);
    renderPanels();
  }

  function seg(field, labelId) {
    const name = `f-${field.key}`;
    const box = el('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': labelId });
    for (const [value, label] of field.options) {
      const input = el('input', { type: 'radio', name, value: String(value), 'data-k': `${field.key}:${value}` });
      input.checked = String(s[field.key]) === String(value);
      input.addEventListener('change', () => set({ [field.key]: typeof value === 'number' ? Number(value) : value }));
      box.append(el('label', {}, [input, el('span', { text: label })]));
    }
    return box;
  }

  function swatches(field, labelId) {
    const box = el('div', { class: 'swatches', role: 'radiogroup', 'aria-labelledby': labelId });
    for (const [value, css] of Object.entries(COLORS)) {
      const input = el('input', { type: 'radio', name: `f-${field.key}`, value, 'aria-label': colorName(value), 'data-k': `${field.key}:${value}` });
      input.checked = s[field.key] === value;
      input.addEventListener('change', () => set({ [field.key]: value }));
      const dot = el('span');
      dot.style.setProperty('--sw', css);
      box.append(el('label', { title: colorName(value) }, [input, dot]));
    }
    return box;
  }

  function range(field, id, info) {
    const text = (v) => field.fmt(Number(v));
    const out = el('span', { class: 'readout', text: text(s[field.key]), 'aria-hidden': 'true' });
    const input = el('input', { type: 'range', id, min: field.min, max: field.max, step: field.step, 'data-k': field.key });
    input.value = s[field.key];
    input.setAttribute('aria-valuetext', text(s[field.key]));
    input.addEventListener('input', () => {
      out.textContent = text(input.value);
      input.setAttribute('aria-valuetext', text(input.value));
      s[field.key] = Number(input.value);
      api.setSettings({ [field.key]: Number(input.value) });
    });
    return [el('div', { class: 'field-row' }, [el('label', { class: 'field-name', for: id, text: field.label }), el('span', { class: 'field-name' }, [out, info])]), input];
  }

  function select(field, id) {
    const input = el('select', { id, 'data-k': field.key });
    let found = false;
    for (const [value, label] of field.options()) {
      const o = el('option', { value: String(value), text: label });
      if (String(value) === String(s[field.key])) { o.selected = true; found = true; }
      input.append(o);
    }
    if (!found) {
      input.prepend(el('option', { value: String(s[field.key]), text: 'Disconnected display' }));
      input.value = String(s[field.key]);
    }
    input.addEventListener('change', () => set({ [field.key]: Number(input.value) }));
    return input;
  }

  function check(field) {
    const input = el('input', { type: 'checkbox', 'data-k': field.key });
    input.checked = !!s[field.key];
    input.addEventListener('change', () => set({ [field.key]: input.checked }));
    return el('label', { class: 'check' }, [input, el('span', { text: field.label })]);
  }

  function fieldNode(field) {
    if (field.custom) return CUSTOM[field.custom]();
    const id = `f-${field.key}`;
    const info = field.info ? infoButton(field.key, field.label) : null;
    const parts = [];
    if (field.type === 'check') {
      parts.push(el('div', { class: 'field-row' }, [check(field), info]));
    } else if (field.type === 'range') {
      parts.push(...range(field, id, info));
    } else {
      const labelId = `${id}-label`;
      const name = field.type === 'select'
        ? el('label', { class: 'field-name', for: id, id: labelId, text: field.label })
        : el('span', { class: 'field-name', id: labelId, text: field.label });
      const value = field.type === 'swatches' ? el('span', { class: 'readout', text: colorName(s[field.key]), 'aria-hidden': 'true' }) : null;
      parts.push(el('div', { class: 'field-row' }, [name, value, info]));
      if (field.type === 'seg') parts.push(seg(field, labelId));
      if (field.type === 'swatches') parts.push(swatches(field, labelId));
      if (field.type === 'select') parts.push(select(field, id));
    }
    if (field.info) parts.push(tipNode(field.key, field.info(s[field.key])));
    return el('div', { class: 'field', 'data-f': field.key }, parts);
  }

  const CUSTOM = {
    model() {
      const models = state.models;
      const current = models.find((m) => m.id === s.speechModel) || models[0];
      const pick = el('select', { id: 'f-speechModel', 'data-k': 'speechModel' });
      for (const m of models) {
        const o = el('option', { value: m.id, text: `${m.label}${m.installed ? ' ✓' : ''}` });
        o.selected = m.id === current.id;
        pick.append(o);
      }
      pick.addEventListener('change', () => set({ speechModel: pick.value }));
      const row = el('div', { class: 'model-row' });
      if (current.downloading !== null && current.downloading !== undefined) {
        const pct = Math.round(current.downloading * 100);
        const bar = el('i');
        bar.style.width = `${pct}%`;
        row.append(
          el('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Download progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, bar),
          el('span', { class: 'readout', text: `${pct}%`, 'aria-hidden': 'true' }),
        );
      } else if (current.installed) {
        row.append(el('span', { class: 'note ok', text: 'Installed. Works offline.' }));
        row.append(el('button', { class: 'small danger', type: 'button', text: 'Remove', 'data-k': 'model-remove', onclick: () => api.removeModel(current.id) }));
      } else {
        row.append(el('span', { class: 'note', text: 'Not downloaded' }));
        row.append(el('button', { class: 'small', type: 'button', text: 'Download', 'data-k': 'model-download', onclick: () => download(current.id) }));
      }
      return el('div', { class: 'field', 'data-f': 'speechModel' }, [
        el('div', { class: 'field-row' }, [el('label', { class: 'field-name', for: 'f-speechModel', text: 'Speech model' }), infoButton('speechModel', 'the speech model')]),
        pick,
        row,
        downloadErrors[current.id] ? el('p', { class: 'note error', text: downloadErrors[current.id] }) : null,
        tipNode('speechModel', 'You download it once, from the sherpa-onnx project on GitHub. Then recognition runs on this computer. Audio never leaves it.'),
      ]);
    },
    mic() {
      const pick = el('select', { id: 'f-mic', 'data-k': 'mic' });
      pick.append(el('option', { value: '', text: 'System default' }));
      mics.forEach((m, i) => pick.append(el('option', { value: m.deviceId, text: m.label || `Microphone ${i + 1}` })));
      pick.value = mics.some((m) => m.deviceId === s.selectedMicId) ? s.selectedMicId : '';
      pick.addEventListener('change', () => set({ selectedMicId: pick.value }));
      pick.addEventListener('focus', refreshMics);
      return el('div', { class: 'field', 'data-f': 'mic' }, [
        el('div', { class: 'field-row' }, el('label', { class: 'field-name', for: 'f-mic', text: 'Microphone' })),
        pick,
      ]);
    },
    remote() {
      const r = state.lan.remote || {};
      const parts = [el('div', { class: 'field', 'data-f': 'browserServerEnabled' }, [
        el('div', { class: 'field-row' }, [check({ key: 'browserServerEnabled', label: 'Show on phones and tablets' }), infoButton('remote', 'phones and tablets')]),
        tipNode('remote', `Open the link in any browser on the same Wi-Fi. Words, progress and the waveform follow live. No app needed. Live updates use port ${Number(s.browserServerPort) + 1}.`),
      ])];
      if (r.running) {
        parts.push(el('div', { class: 'field', 'data-f': 'remoteQr' }, [
          el('div', { class: 'qr-pair' }, [
            el('figure', { class: 'qr' }, [el('img', { src: r.qr, alt: 'QR code for the remote prompter' }), el('figcaption', { text: 'Normal' })]),
            el('figure', { class: 'qr' }, [el('img', { src: r.mirrorQr, alt: 'QR code for the mirrored remote prompter' }), el('figcaption', { text: 'Mirrored' })]),
          ]),
          el('code', { text: r.url }),
        ]));
      } else if (r.error) {
        parts.push(el('p', { class: 'note error', text: r.error }));
      }
      parts.push(portField('browserServerPort'));
      return parts;
    },
    director() {
      const d = state.lan.director || {};
      const parts = [el('div', { class: 'field', 'data-f': 'directorModeEnabled' }, [
        el('div', { class: 'field-row' }, [check({ key: 'directorModeEnabled', label: 'Let someone else run the script' }), infoButton('director', 'Director Mode')]),
        tipNode('director', `The director writes and starts the script from a browser. Text you already read is locked. The rest stays editable. Live updates use port ${Number(s.directorServerPort) + 1}.`),
        el('p', { class: 'note warn' }, [el('b', { text: 'Not encrypted.' }), ' Use only on networks you trust.']),
      ])];
      if (d.running) {
        parts.push(el('div', { class: 'field', 'data-f': 'directorQr' }, [
          el('figure', { class: 'qr' }, [el('img', { src: d.qr, alt: 'QR code for the director page' })]),
          el('code', { text: d.url }),
        ]));
      } else if (d.error) {
        parts.push(el('p', { class: 'note error', text: d.error }));
      }
      parts.push(portField('directorServerPort'));
      return parts;
    },
  };

  function portField(key) {
    const id = `f-${key}`;
    const input = el('input', { type: 'number', id, min: 1024, max: 65534, 'data-k': key });
    input.value = s[key];
    input.addEventListener('change', () => set({ [key]: Number(input.value) }));
    return el('div', { class: 'field-row', 'data-f': key }, [el('label', { class: 'field-name', for: id, text: 'Port' }), input]);
  }

  function cardNode(card) {
    const fields = card.fields.filter((f) => !f.show || f.show());
    if (!fields.length) return null;
    const titleId = `card-${card.id}`;
    return el('section', { class: 'card', 'aria-labelledby': titleId }, [
      el('div', { class: 'card-head' }, [
        el('h2', { class: 'label', id: titleId, text: card.title }),
        card.aside ? el('span', { class: 'readout', text: card.aside() }) : null,
      ]),
      ...fields.flatMap((f) => [].concat(fieldNode(f))),
    ]);
  }

  function selectTab(id, focus) {
    activeTab = id;
    try { localStorage.setItem('glassprompter.tab', activeTab); } catch (e) { /* storage blocked */ }
    renderTabs();
    renderPanels();
    if (focus) $(`tab-${id}`).focus();
  }

  function renderTabs() {
    const tabs = $('tabs');
    if (!tabs.childElementCount) {
      tabs.append(...TABS.map((t) => el('button', {
        type: 'button',
        role: 'tab',
        id: `tab-${t.id}`,
        'aria-controls': 'panels',
        text: t.label,
        onclick: () => selectTab(t.id),
      })));
    }
    for (const b of tabs.children) {
      const on = b.id === `tab-${activeTab}`;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  // Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
  $('tabs').addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === activeTab);
    const n = TABS.length;
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(TABS[next].id, true);
  });

  // Settings re-render on every change. Keep focus and scroll where they were,
  // and let fields that a choice reveals fade in together.
  let lastTab = null;
  let shown = new Set();
  function renderPanels() {
    if (!state) return;
    const panels = $('panels');
    const scroll = panels.scrollTop;
    const focusKey = panels.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
    panels.replaceChildren(...tab.cards.map(cardNode).filter(Boolean));
    panels.setAttribute('aria-labelledby', `tab-${tab.id}`);
    const fields = [...panels.querySelectorAll('[data-f]')];
    if (lastTab === tab.id) for (const f of fields) if (!shown.has(f.dataset.f)) f.classList.add('enter');
    shown = new Set(fields.map((f) => f.dataset.f));
    panels.scrollTop = lastTab === tab.id ? scroll : 0;
    lastTab = tab.id;
    if (focusKey) panels.querySelector(`[data-k="${CSS.escape(focusKey)}"]`)?.focus();
  }

  async function refreshMics() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const next = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
      const changed = JSON.stringify(next.map((d) => [d.deviceId, d.label])) !== JSON.stringify(mics.map((d) => [d.deviceId, d.label]));
      mics = next;
      if (changed && document.activeElement?.dataset?.k !== 'mic') renderPanels();
    } catch (e) {
      mics = [];
    }
  }

  async function download(id) {
    delete downloadErrors[id];
    announce('Downloading the speech model.');
    const result = await api.downloadModel(id);
    if (!result.ok) downloadErrors[id] = result.error;
    announce(result.ok ? 'Speech model installed.' : `Download failed. ${result.error || ''}`);
    hideBanner();
    renderPanels();
    return result.ok;
  }

  // ---------------------------------------------------------------- status

  let announceTimer = 0;
  function announce(text) {
    const region = $('sr-status');
    region.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { region.textContent = text; }, 50);
  }

  // ---------------------------------------------------------------- shortcuts sheet

  let returnFocus = null;
  function openShortcuts(section) {
    const dialog = $('shortcuts');
    if (!dialog.open) {
      const active = document.activeElement;
      returnFocus = { node: active, key: active?.dataset?.k };
      dialog.showModal();
    }
    if (section) $(section).scrollIntoView({ block: 'start' });
  }
  $('btn-keys').addEventListener('click', () => openShortcuts());
  $('shortcuts-close').addEventListener('click', () => $('shortcuts').close());
  $('shortcuts').addEventListener('click', (e) => { if (e.target === $('shortcuts')) $('shortcuts').close(); });
  $('shortcuts').addEventListener('close', () => {
    if (!returnFocus) return;
    const { node, key } = returnFocus;
    returnFocus = null;
    const target = node && node.isConnected ? node : key && document.querySelector(`[data-k="${CSS.escape(key)}"]`);
    if (target) target.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1') {
      e.preventDefault();
      openShortcuts();
      return;
    }
    // Esc closes the open tip next to the focus, or all of them.
    if (e.key !== 'Escape' || $('shortcuts').open) return;
    const open = [...document.querySelectorAll('.info[aria-expanded="true"]')];
    if (!open.length) return;
    const active = document.activeElement;
    const own = open.find((b) => b === active || b.closest('.field')?.contains(active) || $(b.getAttribute('aria-controls'))?.contains(active));
    for (const b of own ? [own] : open) setTip(b, false);
    if (own) own.focus();
  });

  // ---------------------------------------------------------------- document

  function wordCount(text) {
    const m = text.replace(/\[[^\]]*\]/g, ' ').match(/\S+/g);
    return m ? m.length : 0;
  }
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function renderStats() {
    const page = doc.pages[doc.currentPageIndex] || '';
    const n = wordCount(page);
    const all = doc.pages.reduce((sum, p) => sum + wordCount(p), 0);
    let text = n ? `${n} words · ${fmt((n / 150) * 60)}` : 'Empty page';
    if (doc.pages.length > 1) text += ` · ${all} in all`;
    $('stats').textContent = text;
    $('stats').title = 'Reading time at 150 words a minute';
    $('btn-start').disabled = !reading.active && !n;
    $('btn-all').disabled = reading.active || !all;
  }

  function renderPages() {
    const list = $('page-list');
    list.replaceChildren(...doc.pages.map((text, i) => {
      const first = text.trim().split('\n')[0] || 'Empty';
      const active = i === doc.currentPageIndex;
      const isReading = reading.active && reading.pageIndex === i && !reading.directorMode;
      const li = el('li', { class: `page-item${active ? ' active' : ''}${isReading ? ' reading' : ''}` });
      li.append(el('button', {
        class: 'page',
        type: 'button',
        'aria-current': active ? 'true' : null,
        onclick: () => {
          doc.currentPageIndex = i;
          api.updateDoc({ currentPageIndex: i });
          renderDoc();
          $('script').focus();
        },
      }, [
        el('b', {}, [el('span', { class: 'sr-only', text: 'Page ' }), String(i + 1), isReading ? el('span', { class: 'sr-only', text: ', reading now' }) : null]),
        el('span', { class: 'snip', text: first }),
      ]));
      if (doc.pages.length > 1) {
        li.append(el('button', {
          class: 'del',
          type: 'button',
          title: 'Delete page',
          'aria-label': `Delete page ${i + 1}`,
          text: '×',
          onclick: () => {
            doc.pages.splice(i, 1);
            if (doc.currentPageIndex >= doc.pages.length) doc.currentPageIndex = doc.pages.length - 1;
            else if (doc.currentPageIndex > i) doc.currentPageIndex -= 1;
            api.updateDoc({ pages: doc.pages, currentPageIndex: doc.currentPageIndex });
            renderDoc();
            list.querySelector('.active button.page')?.focus();
          },
        }));
      }
      return li;
    }));
    $('script-label').textContent = doc.pages.length > 1 ? `Page ${doc.currentPageIndex + 1}` : 'Script';
  }

  function renderFileName() {
    $('file-name').textContent = doc.fileName || 'Untitled';
    $('dirty').hidden = !doc.dirty;
  }

  function renderDoc() {
    const area = $('script');
    const value = doc.pages[doc.currentPageIndex] || '';
    if (area.value !== value) area.value = value;
    renderFileName();
    renderPages();
    renderStats();
  }

  let editTimer = 0;
  $('script').addEventListener('input', () => {
    doc.pages[doc.currentPageIndex] = $('script').value;
    renderStats();
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      api.updateDoc({ pages: doc.pages });
      renderPages();
    }, 150);
  });

  $('add-page').addEventListener('click', () => {
    doc.pages.push('');
    doc.currentPageIndex = doc.pages.length - 1;
    api.updateDoc({ pages: doc.pages, currentPageIndex: doc.currentPageIndex });
    renderDoc();
    $('script').focus();
  });

  $('btn-new').addEventListener('click', () => api.newFile());
  $('btn-open').addEventListener('click', () => api.openFile());
  $('btn-save').addEventListener('click', () => api.saveFile());

  // ---------------------------------------------------------------- reading

  function flushEdits() {
    clearTimeout(editTimer);
    api.updateDoc({ pages: doc.pages });
  }

  async function start(index) {
    if (reading.active) {
      api.stop();
      return;
    }
    flushEdits();
    if (s.listeningMode === 'wordTracking') {
      const model = state.models.find((m) => m.id === s.speechModel);
      if (!model || !model.installed) {
        showBanner({
          text: 'Word Tracking needs a speech model. You download it once.',
          primary: model && model.downloading != null ? 'Downloading…' : 'Download',
          onPrimary: async () => {
            $('banner-primary').textContent = 'Downloading…';
            $('banner-primary').disabled = true;
            if (await download(s.speechModel)) api.start(index);
            else showBanner({ text: downloadErrors[s.speechModel] || 'The download failed.', error: true });
          },
          secondary: 'Use Classic',
          onSecondary: () => {
            set({ listeningMode: 'classic' });
            hideBanner();
            api.start(index);
          },
        });
        return;
      }
    }
    hideBanner();
    api.start(index);
  }

  $('btn-start').addEventListener('click', () => start(doc.currentPageIndex));
  $('btn-all').addEventListener('click', () => start(0));

  let wasReading = false;
  function renderReading() {
    document.body.classList.toggle('reading', !!reading.active);
    $('start-label').textContent = reading.active ? 'Stop reading' : 'Start reading';
    if (!!reading.active !== wasReading) {
      if (state) announce(reading.active ? 'Reading started.' : 'Reading stopped.');
      wasReading = !!reading.active;
    }
    renderPages();
    renderStats();
  }

  // ---------------------------------------------------------------- banner

  let bannerHandlers = {};
  function showBanner({ text, primary, onPrimary, secondary, onSecondary, error }) {
    bannerHandlers = { onPrimary, onSecondary };
    $('banner').hidden = false;
    $('banner').classList.toggle('error', !!error);
    $('banner-text').textContent = text;
    $('banner-primary').hidden = !primary;
    $('banner-primary').disabled = false;
    $('banner-primary').textContent = primary || '';
    $('banner-secondary').hidden = !secondary;
    $('banner-secondary').textContent = secondary || '';
    announce(text);
  }
  function hideBanner() {
    $('banner').hidden = true;
  }
  $('banner-primary').addEventListener('click', () => bannerHandlers.onPrimary && bannerHandlers.onPrimary());
  $('banner-secondary').addEventListener('click', () => bannerHandlers.onSecondary && bannerHandlers.onSecondary());
  $('banner-close').addEventListener('click', hideBanner);

  // ---------------------------------------------------------------- director cover

  function renderDirector() {
    const d = state.lan.director || {};
    const on = !!(s.directorModeEnabled && d.running);
    $('director-cover').hidden = !on;
    $('script').disabled = on;
    $('btn-start').hidden = on;
    $('btn-all').hidden = on;
    if (on) {
      $('director-qr').src = d.qr || '';
      $('director-url').textContent = d.url || '';
    }
  }
  $('director-off').addEventListener('click', () => set({ directorModeEnabled: false }));

  // ---------------------------------------------------------------- drag and drop

  const drop = $('drop');
  drop.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    drop.classList.add('over');
    $('drop-hint').hidden = false;
  });
  drop.addEventListener('dragleave', (e) => {
    if (drop.contains(e.relatedTarget)) return;
    drop.classList.remove('over');
    $('drop-hint').hidden = true;
  });
  drop.addEventListener('drop', (e) => {
    drop.classList.remove('over');
    $('drop-hint').hidden = true;
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    const p = api.pathForFile(file);
    if (p) api.openPath(p);
  });

  // ---------------------------------------------------------------- boot

  // Mac shortcuts use Command, not Control.
  function useMacKeys() {
    mod = '⌘';
    for (const k of document.querySelectorAll('kbd.mod')) k.textContent = '⌘';
    for (const node of document.querySelectorAll('[title*="Ctrl+"]')) node.title = node.title.replace(/Ctrl\+/g, '⌘');
    for (const node of document.querySelectorAll('[aria-keyshortcuts*="Control+"]')) {
      node.setAttribute('aria-keyshortcuts', node.getAttribute('aria-keyshortcuts').replace(/Control\+/g, 'Meta+'));
    }
  }

  api.onDoc((next) => {
    doc = next;
    renderDoc();
  });
  api.onDocMeta((meta) => {
    doc.fileName = meta.fileName;
    doc.dirty = meta.dirty;
    renderFileName();
  });
  api.onSettings((next) => {
    const modelChanged = next.speechModel !== s.speechModel;
    s = next;
    if (state) state.settings = next;
    if (modelChanged || document.activeElement?.type !== 'range') renderPanels();
    renderDirector();
  });
  api.onModels((models) => {
    state.models = models;
    renderPanels();
  });
  api.onLan((lan) => {
    state.lan = lan;
    renderPanels();
    renderDirector();
  });
  api.onDisplays((displays) => {
    state.displays = displays;
    renderPanels();
  });
  api.onSession((next) => {
    reading = next;
    renderReading();
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics);

  api.getState().then((initial) => {
    state = initial;
    s = initial.settings;
    doc = initial.doc;
    reading = initial.session;
    wasReading = !!reading.active;
    document.body.classList.add(`platform-${initial.platform}`);
    if (initial.platform === 'darwin') useMacKeys();
    renderTabs();
    renderDoc();
    renderPanels();
    renderReading();
    renderDirector();
    refreshMics();
    $('script').focus();
  });
})();
