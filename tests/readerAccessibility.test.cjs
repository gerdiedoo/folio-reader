const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');

// Exercise the actual components' native event handlers and exposed properties.
// This lightweight hook harness does not simulate native focus or TalkBack speech.
function harness({ runEffects = false } = {}) {
  const slots = [];
  const effects = new Map();
  const timers = new Map();
  const listeners = new Set();
  let nextTimer = 1;
  let pending = [];
  let cursor = 0;
  const react = {
    ...React,
    useMemo: fn => fn(),
    useEffect(fn, deps) {
      const at = cursor++;
      if (!runEffects) return;
      const old = effects.get(at);
      if (!old || !deps || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        pending.push(() => {
          old?.cleanup?.();
          effects.set(at, { deps, cleanup: fn() });
        });
      }
    },
    useRef(initial) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
    useState(initial) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
      return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value; }];
    },
  };
  react.default = react;
  const palette = { background: '#fff', surface: '#fff', primary: '#333' };
  const theme = {
    colors: palette, F: {}, type: {}, readerFontFamily: () => 'test-font',
    previewPaper: Object.fromEntries(['parchment', 'white', 'sepia', 'charcoal'].map(name => [name, { bg: '#fff', fg: '#111' }])),
  };
  theme.readerPaper = theme.previewPaper;
  const native = {
    View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch',
    Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' },
    StyleSheet: { create: styles => styles, hairlineWidth: 1 },
    Animated: { View: 'Animated.View', Value: class { interpolate() { return 0; } } },
    AppState: { currentState: 'active', addEventListener(_event, callback) { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } },
  };
  const dependencies = {
    react,
    'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../AppTheme': { useAppTheme: () => palette },
    '../../AppTheme': { useAppTheme: () => palette },
    '../theme': theme, '../../theme': theme,
    './ui/Icon': { Icon: 'Icon' }, './ui/ModalShell': { ModalShell: 'ModalShell' },
    './ui/SeekBar': { SeekBar: 'SeekBar' },
    __timers: {
      setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
  };
  function load(relativePath) {
    const filename = path.resolve(__dirname, relativePath);
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = module.paths;
    const originalRequire = loaded.require.bind(loaded);
    loaded.require = name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name.startsWith('.')) return load(path.relative(__dirname, path.resolve(path.dirname(filename), name)) + '.ts');
      return originalRequire(name);
    };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    loaded._compile((runEffects ? "const { setTimeout, clearTimeout } = require('__timers');\n" : '') + code, filename);
    return loaded.exports;
  }
  return {
    load, timers, listeners,
    render(component, props) {
      cursor = 0;
      pending = [];
      const root = component(props);
      for (const effect of pending) effect();
      return root;
    },
    tick() {
      const [id, timer] = timers.entries().next().value ?? [];
      assert.ok(timer, 'No playback timer scheduled');
      timers.delete(id);
      timer.fn();
    },
    appState(state) {
      native.AppState.currentState = state;
      for (const listener of listeners) listener(state);
    },
    unmount() {
      for (const effect of effects.values()) effect.cleanup?.();
      effects.clear();
    },
  };
}

function elements(root) {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(elements);
  return [root, ...elements(root.props?.children)];
}
function labelled(root, label) {
  const found = elements(root).find(node => node.props?.accessibilityLabel === label);
  assert.ok(found, `Missing control: ${label}`);
  return found.props;
}
const action = name => ({ nativeEvent: { actionName: name } });

test('book position exposes spoken chapter/page and moves exactly one stop per adjustment', () => {
  const h = harness();
  const { ScrubBar } = h.load('../src/components/ReaderNavigator.tsx');
  const commits = [];
  const props = { count: 12, index: 4, labelFor: i => `The Garden\nPage ${i + 1} of 12`, onCommit: i => commits.push(i) };
  const bar = h.render(ScrubBar, props).props;
  assert.equal(bar.accessibilityRole, 'adjustable');
  assert.deepEqual(bar.accessibilityValue, { min: 1, max: 12, now: 5, text: 'The Garden, Page 5 of 12' });
  bar.onAccessibilityAction(action('increment'));
  bar.onAccessibilityAction(action('decrement'));
  bar.onAccessibilityAction(action('activate'));
  assert.deepEqual(commits, [5, 3]);
  const next = h.render(ScrubBar, { ...props, index: 5 }).props;
  assert.equal(next.accessibilityValue.now, 6);
  next.onAccessibilityAction(action('increment'));
  assert.deepEqual(commits, [5, 3, 6]);
});

test('book position stays inside the first and last page; empty and one-page books cannot adjust', () => {
  for (const [count, index, attempt] of [[10, 0, 'decrement'], [10, 9, 'increment'], [1, 0, 'increment'], [0, 0, 'increment']]) {
    const h = harness();
    const { ScrubBar } = h.load('../src/components/ReaderNavigator.tsx');
    const bar = h.render(ScrubBar, { count, index, labelFor: i => `Page ${i + 1}`, onCommit: () => assert.fail('Unexpected page change') }).props;
    bar.onAccessibilityAction(action(attempt));
    assert.equal(bar.accessibilityState.disabled, count <= 1);
    assert.ok(bar.accessibilityValue.now >= bar.accessibilityValue.min);
    assert.ok(bar.accessibilityValue.now <= bar.accessibilityValue.max);
    if (count <= 1) assert.deepEqual(bar.accessibilityActions, []);
  }
});

test('touch scrubbing still previews without jumping, commits once on release, and cancels safely', () => {
  const h = harness();
  const { ScrubBar } = h.load('../src/components/ReaderNavigator.tsx');
  const commits = [];
  const bar = h.render(ScrubBar, { count: 11, index: 0, labelFor: String, onCommit: i => commits.push(i) }).props;
  const touch = x => ({ nativeEvent: { locationX: x } });
  bar.onLayout({ nativeEvent: { layout: { width: 200 } } });
  bar.onResponderGrant(touch(60));
  bar.onResponderMove(touch(160));
  assert.deepEqual(commits, []);
  bar.onResponderRelease();
  bar.onResponderRelease();
  assert.deepEqual(commits, [8]);
  bar.onResponderGrant(touch(200));
  bar.onResponderTerminate();
  bar.onResponderRelease();
  assert.deepEqual(commits, [8]);
});

test('contents exposes chapter names, current selection and a named close action', () => {
  const h = harness();
  const { ChapterSheet } = h.load('../src/components/ReaderNavigator.tsx');
  const selected = [];
  let closed = false;
  const root = h.render(ChapterSheet, {
    chapters: [{ number: '1', title: 'Arrival', startIndex: 0, pageCount: 3 }, { number: '2', title: 'The Garden', startIndex: 3, pageCount: 4 }],
    currentIndex: 1, onSelect: i => selected.push(i), onClose: () => { closed = true; },
  });
  const chapter = labelled(root, 'Chapter 2: The Garden, starts at page 4');
  assert.equal(chapter.accessibilityRole, 'button');
  assert.deepEqual(chapter.accessibilityState, { selected: true });
  chapter.onPress();
  assert.deepEqual(selected, [3]);
  labelled(root, 'Close contents').onPress();
  assert.equal(closed, true);
});

test('text size is adjustable and applied to saved settings with bounded values', () => {
  for (const [start, adjustments, expected] of [[4, ['increment', 'increment'], 6], [1, ['decrement'], 1], [8, ['increment'], 8]]) {
    const h = harness();
    const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
    const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
    let saved;
    const props = { settings: { ...INITIAL_SETTINGS, fontSizeStep: start }, onSave: s => { saved = s; }, onClose() {} };
    let root = h.render(SettingsSheet, props);
    for (const adjustment of adjustments) {
      const control = labelled(root, 'Text size');
      assert.equal(control.accessibilityRole, 'adjustable');
      assert.equal(control.accessibilityValue.min, 1);
      assert.equal(control.accessibilityValue.max, 8);
      control.onAccessibilityAction(action(adjustment));
      root = h.render(SettingsSheet, props);
    }
    assert.equal(labelled(root, 'Text size').accessibilityValue.now, expected);
    const apply = elements(root).find(node => node.type === 'Pressable' && elements(node).some(child => child.props?.children === 'Keep Changes'));
    apply.props.onPress();
    assert.equal(saved.fontSizeStep, expected);
    assert.equal(labelled(root, 'Decrease text size').disabled, expected === 1);
    assert.equal(labelled(root, 'Increase text size').disabled, expected === 8);
  }
});

test('spacing and margins have distinct names and selected states', () => {
  const h = harness();
  const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
  const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
  const props = { settings: INITIAL_SETTINGS, onSave() {}, onClose() {} };
  let root = h.render(SettingsSheet, props);
  assert.deepEqual(labelled(root, 'standard line spacing').accessibilityState, { selected: true });
  labelled(root, 'wide margins').onPress();
  root = h.render(SettingsSheet, props);
  assert.deepEqual(labelled(root, 'wide margins').accessibilityState, { selected: true });
  assert.deepEqual(labelled(root, 'regular margins').accessibilityState, { selected: false });
});

test('hidden bottom navigation cannot receive accessibility focus; visible tabs announce selection', () => {
  const h = harness();
  const { BottomNav } = h.load('../src/components/BottomNav.tsx');
  const props = { activeTab: 'reading', onTabChange() {} };
  const hidden = h.render(BottomNav, { ...props, visible: false });
  assert.equal(hidden.props.accessibilityElementsHidden, true);
  assert.equal(hidden.props.importantForAccessibility, 'no-hide-descendants');
  const shown = h.render(BottomNav, { ...props, visible: true });
  assert.equal(shown.props.accessibilityElementsHidden, false);
  assert.equal(shown.props.importantForAccessibility, 'auto');
  assert.equal(labelled(shown, 'Reading').accessibilityRole, 'tab');
  assert.deepEqual(labelled(shown, 'Reading').accessibilityState, { selected: true });
  assert.deepEqual(labelled(shown, 'Library').accessibilityState, { selected: false });
});

test('modal scrim stays out of focus and its card handles accessibility escape', () => {
  const h = harness();
  const { ModalShell } = h.load('../src/components/ui/ModalShell.tsx');
  let closed = false;
  const root = h.render(ModalShell, { onClose: () => { closed = true; }, children: 'Dialog content' });
  const scrim = elements(root).find(node => node.type === 'Pressable');
  assert.equal(scrim.props.accessible, false);
  assert.equal(scrim.props.importantForAccessibility, 'no');
  const card = elements(root).find(node => node.props?.accessibilityViewIsModal);
  card.props.onAccessibilityEscape();
  assert.equal(closed, true);
});

function page(pageNumber, text) {
  return { chapterNumber: 'I', chapterTitle: 'Arrival', dropCap: '', paragraph1: text, paragraph2Lead: '', highlightedText: '', paragraph2Rest: '', pageNumber, locNumber: pageNumber * 100 };
}
function lineReaderProps(overrides = {}) {
  return {
    book: { id: 'book', title: 'A book', currentPage: 1, currentLoc: 100 },
    chapterTitle: 'Arrival', chapterPages: [page(1, 'one two'), page(2, 'three four')],
    initialPageNumber: 1, onPassageChange() {},
    settings: { theme: 'parchment', font: 'Literata', wpm: 240 },
    onExit() {}, onAddHighlight() {}, showToast() {}, ...overrides,
  };
}
function wordControl(root) { return elements(root).find(node => node.type === 'SeekBar').props; }

test('single-line playback waits for Play, reports source passages and stops at chapter end', () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  const passages = [];
  const props = lineReaderProps({ onPassageChange: p => passages.push(p.pageNumber) });
  let root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 0);
  assert.equal(wordControl(root).index, 0);
  labelled(root, 'Play chapter').onPress();
  root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 250);
  for (let i = 0; i < 3; i++) { h.tick(); root = h.render(SingleLineReader, props); }
  root = h.render(SingleLineReader, props);
  assert.equal(wordControl(root).index, 3);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(passages, [1, 2]);
  labelled(root, 'Replay chapter').onPress();
  root = h.render(SingleLineReader, props);
  assert.equal(wordControl(root).index, 0);
  assert.equal(h.timers.size, 1);
  h.unmount();
});

test('backgrounding cancels the tick immediately and returning never resumes playback', () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  const props = lineReaderProps();
  let root = h.render(SingleLineReader, props);
  labelled(root, 'Play chapter').onPress();
  root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 1);
  h.appState('inactive');
  assert.equal(h.timers.size, 0);
  root = h.render(SingleLineReader, props);
  assert.equal(wordControl(root).index, 0);
  h.appState('background');
  h.appState('active');
  root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 0);
  labelled(root, 'Play chapter').onPress();
  root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 1);
  h.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
});

test('single-line starts at the selected passage; seeking and saving pause at the correct source', () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  const quotes = [];
  const props = lineReaderProps({ initialPageNumber: 2, onAddHighlight: quote => quotes.push(quote) });
  let root = h.render(SingleLineReader, props);
  assert.equal(wordControl(root).index, 2);
  labelled(root, 'Play chapter').onPress();
  root = h.render(SingleLineReader, props);
  labelled(root, 'Save current passage').onPress();
  root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 0);
  assert.equal(quotes[0].text, 'three four');
  assert.equal(quotes[0].page, 2);
  assert.equal(quotes[0].loc, 200);
  labelled(root, 'Play chapter').onPress();
  root = h.render(SingleLineReader, props);
  wordControl(root).onChange(1);
  root = h.render(SingleLineReader, props);
  assert.equal(wordControl(root).index, 1);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('opening an overlay stops playback and closing it waits for another explicit Play', () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  const props = lineReaderProps();
  let root = h.render(SingleLineReader, props);
  labelled(root, 'Play chapter').onPress();
  root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 1);
  root = h.render(SingleLineReader, { ...props, playbackBlocked: true });
  root = h.render(SingleLineReader, { ...props, playbackBlocked: true });
  assert.equal(h.timers.size, 0);
  assert.equal(labelled(root, 'Play chapter').disabled, true);
  labelled(root, 'Play chapter').onPress();
  root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 0);
  assert.equal(wordControl(root).index, 0);
  h.unmount();
});

test('speed changes replace the pending tick; Focus and Tape keep the current word', () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  const props = lineReaderProps();
  let root = h.render(SingleLineReader, props);
  wordControl(root).onChange(1);
  root = h.render(SingleLineReader, props);
  labelled(root, 'Tape display').onPress();
  root = h.render(SingleLineReader, props);
  assert.deepEqual(labelled(root, 'Tape display').accessibilityState, { selected: true });
  assert.equal(wordControl(root).index, 1);
  labelled(root, 'Play chapter').onPress();
  root = h.render(SingleLineReader, props);
  labelled(root, '300 words per minute').onPress();
  root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 200);
  h.unmount();
});

test('empty and one-word chapters never schedule playback, and empty text cannot save a quote', () => {
  for (const text of ['', 'alone']) {
    const h = harness({ runEffects: true });
    const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
    const quotes = [];
    const props = lineReaderProps({ chapterPages: [page(1, text)], onAddHighlight: q => quotes.push(q) });
    const root = h.render(SingleLineReader, props);
    assert.equal(labelled(root, 'Play chapter').disabled, true);
    labelled(root, 'Play chapter').onPress();
    labelled(root, 'Save current passage').onPress();
    h.render(SingleLineReader, props);
    assert.equal(h.timers.size, 0);
    assert.equal(quotes.length, text ? 1 : 0);
    assert.equal(labelled(root, 'Save current passage').disabled, !text);
    h.unmount();
  }
});

test('word-position actions move one word, clamp at bounds, and retain touch seeking', () => {
  for (const [count, index] of [[5, 2], [5, 0], [5, 4], [1, 0], [0, 0]]) {
    const h = harness();
    const { SeekBar } = h.load('../src/components/ui/SeekBar.tsx');
    const changes = [];
    const root = h.render(SeekBar, { count, index, word: 'garden', onChange: i => changes.push(i) });
    const slider = labelled(root, 'Word position');
    assert.equal(slider.accessibilityRole, 'adjustable');
    slider.onAccessibilityAction(action('increment'));
    slider.onAccessibilityAction(action('decrement'));
    slider.onAccessibilityAction(action('activate'));
    const expected = count <= 1 ? [] : [index + 1, index - 1].filter(i => i >= 0 && i < count);
    assert.deepEqual(changes, expected);
    assert.equal(slider.accessibilityState.disabled, count <= 1);
    if (count > 1) {
      slider.onLayout({ nativeEvent: { layout: { width: 200 } } });
      slider.onResponderGrant({ nativeEvent: { locationX: 200 } });
      assert.equal(changes.at(-1), count - 1);
    }
  }
});
