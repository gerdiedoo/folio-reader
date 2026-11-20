const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');

// Exercise the actual components' native event handlers and exposed properties.
// This lightweight hook harness does not simulate native focus or TalkBack speech.
function harness({ runEffects = false, reducedMotion: initialReducedMotion = true, moduleMocks = {} } = {}) {
  const slots = [];
  const effects = new Map();
  const timers = new Map();
  const listeners = new Set();
  let nextTimer = 1;
  let pending = [];
  let cursor = 0;
  let stateWrites = 0;
  let now = 0;
  let reducedMotion = initialReducedMotion;
  const animations = [];
  const announcements = [];
  const memo = (create, deps) => {
    const at = cursor++, old = slots[at];
    if (!old || !deps || old.deps?.length !== deps.length || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) slots[at] = { value: create(), deps };
    return slots[at].value;
  };
  const react = {
    ...React,
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
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
      return [slots[at], value => { stateWrites++; slots[at] = typeof value === 'function' ? value(slots[at]) : value; }];
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
    View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch', Image: 'Image',
    FlatList: 'FlatList', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator',
    Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' },
    StyleSheet: { create: styles => styles, hairlineWidth: 1 },
    Easing: { linear: x => x },
    Animated: {
      View: 'Animated.View',
      Value: class {
        constructor(value) { this.value = value; }
        setValue(value) { this.value = value; }
        stopAnimation() {}
        interpolate(config) { return { source: this, config }; }
      },
      timing(value, config) {
        const animation = { kind: 'timing', value, config, started: false, stopped: false,
          start() { this.started = true; }, stop() { this.stopped = true; } };
        animations.push(animation);
        return animation;
      },
      loop(child) {
        const animation = { kind: 'loop', child, started: false, stopped: false,
          start() { this.started = true; }, stop() { this.stopped = true; } };
        animations.push(animation);
        return animation;
      },
    },
    AccessibilityInfo: {
      getRecommendedTimeoutMillis: async duration => duration,
      announceForAccessibility: message => announcements.push({ message }),
      announceForAccessibilityWithOptions: (message, options) => announcements.push({ message, options }),
    },
    AppState: { currentState: 'active', addEventListener(_event, callback) { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } },
  };
  const dependencies = {
    react,
    'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../AppTheme': { useAppTheme: () => palette },
    '../../AppTheme': { useAppTheme: () => palette },
    '../MotionPreferences': { useReducedMotion: () => reducedMotion },
    '../../MotionPreferences': { useReducedMotion: () => reducedMotion },
    '../theme': theme, '../../theme': theme,
    './ui/Icon': { Icon: 'Icon' }, './ui/ModalShell': { ModalShell: 'ModalShell' },
    './ui/SeekBar': { SeekBar: 'SeekBar' },
    './Icon': { Icon: 'Icon' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'MaterialCommunityIcons', MaterialIcons: 'MaterialIcons' },
    __clock: { now: () => now },
    __timers: {
      setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    ...moduleMocks,
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
    loaded._compile((runEffects ? "const { setTimeout, clearTimeout } = require('__timers'); const Date = require('__clock');\n" : '') + code, filename);
    return loaded.exports;
  }
  return {
    load, timers, listeners, native, animations, announcements,
    stateWrites: () => stateWrites,
    reduceMotion(value) { reducedMotion = value; },
    elapse(ms) { now += ms; },
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
      now += timer.ms;
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
    onExit() {}, onAddHighlight: async () => true, showToast() {}, ...overrides,
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

test('single-line starts at the selected passage; seeking and saving pause at the correct source', async () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  const quotes = [];
  const props = lineReaderProps({ initialPageNumber: 2, onAddHighlight: async quote => { quotes.push(quote); return true; } });
  let root = h.render(SingleLineReader, props);
  assert.equal(wordControl(root).index, 2);
  labelled(root, 'Play chapter').onPress();
  root = h.render(SingleLineReader, props);
  await labelled(root, 'Save current passage').onPress();
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

test('empty and one-word chapters never schedule playback, and empty text cannot save a quote', async () => {
  for (const text of ['', 'alone']) {
    const h = harness({ runEffects: true });
    const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
    const quotes = [];
    const props = lineReaderProps({ chapterPages: [page(1, text)], onAddHighlight: async q => { quotes.push(q); return true; } });
    const root = h.render(SingleLineReader, props);
    assert.equal(labelled(root, 'Play chapter').disabled, true);
    labelled(root, 'Play chapter').onPress();
    await labelled(root, 'Save current passage').onPress();
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

test('header and bottom navigation settle immediately under reduced motion and cancel active transitions', () => {
  for (const [file, name] of [['Header', 'Header'], ['BottomNav', 'BottomNav']]) {
    const h = harness({ runEffects: true });
    const Component = h.load(`../src/components/${file}.tsx`)[name];
    const props = { activeTab: 'library', onTabChange() {}, onOpenSearch() {}, onOpenProfile() {}, visible: true };
    let root = h.render(Component, props);
    assert.equal(h.animations.length, 0);
    h.reduceMotion(false);
    root = h.render(Component, { ...props, visible: false });
    assert.equal(h.animations.length, 1);
    assert.equal(h.animations[0].config.duration, 260);
    assert.equal(h.animations[0].started, true);
    h.reduceMotion(true);
    root = h.render(Component, { ...props, visible: false });
    assert.equal(h.animations.length, 1);
    assert.equal(h.animations[0].stopped, true);
    assert.equal(h.animations[0].value.value, 1);
    assert.equal(root.props.accessibilityElementsHidden, true);
    assert.equal(root.props.importantForAccessibility, 'no-hide-descendants');
    h.unmount();
  }
});

test('sheets and dialogs omit their entrance animations when reduced motion is enabled', () => {
  const h = harness();
  const { ModalShell } = h.load('../src/components/ui/ModalShell.tsx');
  const props = { onClose() {}, children: 'Content' };
  for (const align of ['center', 'bottom']) {
    assert.equal(h.render(ModalShell, { ...props, align }).props.animationType, 'none');
  }
  h.reduceMotion(false);
  assert.equal(h.render(ModalShell, { ...props, align: 'bottom' }).props.animationType, 'slide');
  assert.equal(h.render(ModalShell, props).props.animationType, 'fade');
});

test('spinning icons stop their loop when reduced motion changes and retain a static glyph', () => {
  const h = harness({ runEffects: true });
  const { Icon } = h.load('../src/components/ui/Icon.tsx');
  const props = { name: 'sync', spin: true };
  assert.equal(h.render(Icon, props).type, 'MaterialIcons');
  assert.equal(h.animations.length, 0);
  h.reduceMotion(false);
  assert.equal(h.render(Icon, props).type, 'Animated.View');
  const loop = h.animations.find(a => a.kind === 'loop');
  assert.equal(loop.started, true);
  h.reduceMotion(true);
  assert.equal(h.render(Icon, props).type, 'MaterialIcons');
  assert.equal(loop.stopped, true);
  h.unmount();
});

test('feedback settles without a fade and never leaves an invisible message in accessibility focus', () => {
  const h = harness({ runEffects: true });
  const { Toast } = h.load('../src/components/ui/Toast.tsx');
  let root = h.render(Toast, { message: 'Could not save. Try again.', bottom: 20 });
  root = h.render(Toast, { message: 'Could not save. Try again.', bottom: 20 });
  assert.equal(h.animations.length, 0);
  assert.equal(root.props.accessibilityLabel, 'Could not save. Try again.');
  assert.equal(root.props.accessibilityElementsHidden, false);
  assert.equal(root.props.style[1].opacity.value, 1);
  assert.equal(elements(root).find(node => node.type === 'Icon').props.name, 'info');
  root = h.render(Toast, { message: null, bottom: 20 });
  assert.equal(root.props.style[1].opacity.value, 0);
  assert.equal(root.props.accessibilityElementsHidden, true);
  assert.equal(root.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(root.props.accessibilityLabel, undefined);
  h.unmount();
});

test('feedback announces each requested message once and extends to the Android timeout from the original start', async () => {
  const h = harness({ runEffects: true });
  let resolve;
  h.native.AccessibilityInfo.getRecommendedTimeoutMillis = duration => {
    assert.equal(duration, 5000);
    return new Promise(ok => { resolve = ok; });
  };
  const { useFeedbackMessage } = h.load('../src/lib/useFeedbackMessage.ts');
  let result = h.render(useFeedbackMessage);
  result.showMessage('Bookmark saved');
  result = h.render(useFeedbackMessage);
  assert.equal(result.message, 'Bookmark saved');
  assert.equal([...h.timers.values()][0].ms, 5000);
  assert.deepEqual(h.announcements, [{ message: 'Bookmark saved' }]);
  h.render(useFeedbackMessage);
  assert.equal(h.announcements.length, 1);
  h.elapse(1000);
  resolve(20000);
  await Promise.resolve();
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 19000);
  h.tick();
  result = h.render(useFeedbackMessage);
  assert.equal(result.message, null);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('late timeout recommendations cannot extend a replaced message or schedule after unmount', async () => {
  const h = harness({ runEffects: true });
  const resolves = [];
  h.native.AccessibilityInfo.getRecommendedTimeoutMillis = () => new Promise(ok => resolves.push(ok));
  const { useFeedbackMessage } = h.load('../src/lib/useFeedbackMessage.ts');
  let result = h.render(useFeedbackMessage);
  result.showMessage('First');
  result = h.render(useFeedbackMessage);
  result.showMessage('Second');
  result = h.render(useFeedbackMessage);
  resolves[0](60000);
  await Promise.resolve();
  assert.equal([...h.timers.values()][0].ms, 5000);
  assert.equal(result.message, 'Second');
  h.unmount();
  resolves[1](60000);
  await Promise.resolve();
  assert.equal(h.timers.size, 0);
});

test('failed or shorter native recommendations retain five seconds; iOS announcements are queued', async () => {
  for (const value of [100, NaN, Infinity, 'reject']) {
    const h = harness({ runEffects: true });
    h.native.AccessibilityInfo.getRecommendedTimeoutMillis = () => value === 'reject' ? Promise.reject(new Error('Offline')) : Promise.resolve(value);
    const { useFeedbackMessage } = h.load('../src/lib/useFeedbackMessage.ts');
    let result = h.render(useFeedbackMessage);
    result.showMessage('Done');
    result = h.render(useFeedbackMessage);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal([...h.timers.values()][0].ms, 5000);
    h.unmount();
  }
  const h = harness({ runEffects: true });
  h.native.Platform.OS = 'ios';
  h.native.AccessibilityInfo.getRecommendedTimeoutMillis = () => assert.fail('Android API used on iOS');
  const { useFeedbackMessage } = h.load('../src/lib/useFeedbackMessage.ts');
  let result = h.render(useFeedbackMessage);
  result.showMessage('Done');
  result = h.render(useFeedbackMessage);
  result.showMessage('Done');
  h.render(useFeedbackMessage);
  assert.deepEqual(h.announcements, [{ message: 'Done', options: { queue: true } }, { message: 'Done', options: { queue: true } }]);
  assert.equal(h.timers.size, 1);
  h.unmount();
});

function searchHarness() {
  const jobs = [];
  const h = harness({ runEffects: true, moduleMocks: {
    './bookSearch': { searchBookPages(pages, query, { signal }) {
      let resolve, reject;
      const result = new Promise((ok, fail) => { resolve = ok; reject = fail; });
      jobs.push({ pages, query, signal, resolve, reject });
      return result; // Deliberately ignores abort, exercising the hook's stale-result guard.
    } },
  } });
  const { useBookSearch } = h.load('../src/lib/useBookSearch.ts');
  return { h, jobs, hook: ({ pages, query }) => useBookSearch(pages, query) };
}

test('book search debounces typing, ignores stale completions and clears results immediately', async () => {
  const { h, jobs, hook } = searchHarness();
  const pages = [page(1, 'first second third')];
  let result = h.render(hook, { pages, query: 'first' });
  assert.equal(result.status, 'searching');
  assert.equal(jobs.length, 0);
  assert.equal([...h.timers.values()][0].ms, 250);
  h.render(hook, { pages, query: 'second' });
  assert.equal(h.timers.size, 1);
  h.tick();
  assert.equal(jobs[0].query, 'second');
  h.render(hook, { pages, query: 'third' });
  assert.equal(jobs[0].signal.aborted, true);
  h.tick();
  jobs[0].resolve({ matches: [{ id: 'stale' }], hasMore: false });
  await Promise.resolve();
  result = h.render(hook, { pages, query: 'third' });
  assert.equal(result.status, 'searching');
  assert.deepEqual(result.matches, []);
  jobs[1].resolve({ matches: [{ id: 'current' }], hasMore: false });
  await Promise.resolve();
  result = h.render(hook, { pages, query: 'third' });
  assert.equal(result.status, 'ready');
  assert.equal(result.matches[0].id, 'current');
  result = h.render(hook, { pages, query: '' });
  assert.equal(result.status, 'idle');
  assert.deepEqual(result.matches, []);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('changing books hides old matches; unmount cancels work and blocks late state writes', async () => {
  const { h, jobs, hook } = searchHarness();
  const a = [page(1, 'book A')], b = [page(1, 'book B')];
  h.render(hook, { pages: a, query: 'book' });
  h.tick();
  jobs[0].resolve({ matches: [{ id: 'A' }], hasMore: false });
  await Promise.resolve();
  assert.equal(h.render(hook, { pages: a, query: 'book' }).matches[0].id, 'A');
  const switched = h.render(hook, { pages: b, query: 'book' });
  assert.equal(switched.status, 'searching');
  assert.deepEqual(switched.matches, []);
  h.tick();
  assert.equal(jobs[0].signal.aborted, true);
  const writes = h.stateWrites();
  h.unmount();
  assert.equal(jobs[1].signal.aborted, true);
  jobs[1].resolve({ matches: [{ id: 'B' }], hasMore: false });
  await Promise.resolve();
  assert.equal(h.stateWrites(), writes);
  assert.equal(h.timers.size, 0);
});

test('book search failures stay distinct from no matches and can be retried', async () => {
  const { h, jobs, hook } = searchHarness();
  const props = { pages: [page(1, 'a word')], query: 'word' };
  h.render(hook, props);
  h.tick();
  jobs[0].reject(new Error('Could not search this text'));
  await Promise.resolve(); await Promise.resolve();
  let result = h.render(hook, props);
  assert.equal(result.status, 'error');
  assert.equal(result.error, 'Could not search this text');
  result.retry();
  h.render(hook, props);
  h.tick();
  jobs[1].resolve({ matches: [], hasMore: false });
  await Promise.resolve();
  result = h.render(hook, props);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.matches, []);
  h.unmount();
});

test('Find in book exposes named input/close controls and opens the selected source match', async () => {
  const { h, jobs } = searchHarness();
  const { BookSearchSheet } = h.load('../src/components/BookSearchSheet.tsx');
  const selected = [];
  let closed = false;
  const props = { title: 'A book', pages: [page(2, 'A quiet garden')], onClose: () => { closed = true; }, onSelect: item => selected.push(item) };
  let root = h.render(BookSearchSheet, props);
  labelled(root, 'Find text in this book').onChangeText('garden');
  root = h.render(BookSearchSheet, props);
  h.tick();
  const match = { id: '0:0:8:14', sourceIndex: 0, pageNumber: 2, chapterTitle: 'Arrival', before: 'A quiet ', match: 'garden', after: '', wordIndex: 2 };
  jobs[0].resolve({ matches: [match], hasMore: false });
  await Promise.resolve();
  root = h.render(BookSearchSheet, props);
  const list = elements(root).find(node => node.type === 'FlatList');
  assert.equal(list.props.data[0], match);
  const row = list.props.renderItem({ item: match });
  assert.equal(row.props.accessibilityRole, 'button');
  row.props.onPress();
  assert.equal(selected[0], match);
  labelled(root, 'Clear book search').onPress();
  root = h.render(BookSearchSheet, props);
  assert.equal(elements(root).find(node => node.type === 'FlatList').props.data.length, 0);
  labelled(root, 'Close find in book').onPress();
  assert.equal(closed, true);
  h.unmount();
});

function dictionaryHarness() {
  const actual = harness().load('../src/lib/dictionary.ts');
  const jobs = [], voices = [], toasts = [];
  let stops = 0;
  const h = harness({ runEffects: true, moduleMocks: {
    './dictionary': { ...actual, fetchDictionaryDefinition(word, { signal }) {
      let resolve, reject;
      const result = new Promise((ok, fail) => { resolve = ok; reject = fail; });
      jobs.push({ word, signal, resolve, reject });
      return result;
    } },
    'expo-speech': { stop: async () => { stops++; }, speak: (word, options) => voices.push({ word, options }) },
  } });
  const { useDictionaryLookup } = h.load('../src/lib/useDictionaryLookup.ts');
  return { h, jobs, voices, toasts, stops: () => stops, hook: ({ term }) => useDictionaryLookup(term) };
}
const definition = word => ({ definition: `Definition for ${word}`, phonetic: '/word/', partOfSpeech: 'noun', synonyms: [], example: 'An example from the dictionary.' });

test('dictionary results stay bound to their queried word even when old requests ignore abort', async () => {
  const { h, jobs, hook } = dictionaryHarness();
  h.render(hook, { term: 'first' });
  assert.equal(jobs.length, 0);
  assert.equal([...h.timers.values()][0].ms, 450);
  h.tick();
  h.render(hook, { term: 'second' });
  h.tick();
  assert.equal(jobs[0].signal.aborted, true);
  jobs[1].resolve(definition('second'));
  await Promise.resolve();
  jobs[0].resolve(definition('first'));
  await Promise.resolve();
  const { lookup } = h.render(hook, { term: 'second' });
  assert.equal(lookup.key, 'second');
  assert.equal(lookup.status, 'found');
  assert.equal(lookup.entry.definition, 'Definition for second');
  h.unmount();
});

test('bundled words work without requests and cannot be replaced by a stale online error', async () => {
  const { h, jobs, hook } = dictionaryHarness();
  h.render(hook, { term: 'remote' });
  h.tick();
  h.render(hook, { term: ' QUIETUDE ' });
  let result = h.render(hook, { term: ' QUIETUDE ' });
  assert.equal(result.lookup.status, 'found');
  assert.equal(result.lookup.source, 'bundled');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].signal.aborted, true);
  jobs[0].reject(new Error('Late network error'));
  await Promise.resolve(); await Promise.resolve();
  result = h.render(hook, { term: ' QUIETUDE ' });
  assert.equal(result.lookup.source, 'bundled');
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('dictionary failure can retry the same word; missing entries stay separate from network errors', async () => {
  const { h, jobs, hook } = dictionaryHarness();
  h.render(hook, { term: 'word' }); h.tick();
  jobs[0].reject(new Error('The dictionary took too long to respond. Try again.'));
  await Promise.resolve(); await Promise.resolve();
  let result = h.render(hook, { term: 'word' });
  assert.equal(result.lookup.status, 'error');
  assert.match(result.lookup.message, /too long/);
  result.retry(); h.render(hook, { term: 'word' }); h.tick();
  jobs[1].resolve(null); await Promise.resolve();
  result = h.render(hook, { term: 'word' });
  assert.equal(result.lookup.status, 'missing');
  h.unmount();
});

test('closing dictionary cancels debounce/requests and suppresses late state updates', async () => {
  const { h, jobs, hook } = dictionaryHarness();
  h.render(hook, { term: 'word' });
  h.tick();
  const writes = h.stateWrites();
  h.unmount();
  assert.equal(jobs[0].signal.aborted, true);
  jobs[0].resolve(definition('word'));
  await Promise.resolve();
  assert.equal(h.stateWrites(), writes);
  assert.equal(h.timers.size, 0);
});

test('dictionary Save disables immediately for new input and saves a matching word/definition with book context', async () => {
  const { h, jobs } = dictionaryHarness();
  const { DictionaryModal } = h.load('../src/components/DictionaryModal.tsx');
  const saved = [];
  const props = { initialWord: 'first', contextPassage: 'Exact text from my book.', bookId: 'book-A', onSaveToLexicon: entry => saved.push(entry), onClose() {}, showToast() {} };
  let root = h.render(DictionaryModal, props); h.tick();
  jobs[0].resolve(definition('first')); await Promise.resolve();
  root = h.render(DictionaryModal, props);
  assert.equal(labelled(root, 'Save definition to Lexicon Cards').disabled, false);
  labelled(root, 'English dictionary word').onChangeText('second');
  root = h.render(DictionaryModal, props);
  assert.equal(labelled(root, 'Save definition to Lexicon Cards').disabled, true);
  labelled(root, 'Save definition to Lexicon Cards').onPress();
  assert.equal(saved.length, 0);
  assert.ok(!elements(root).some(n => n.props?.children === 'Definition for first'));
  h.tick(); jobs[1].resolve(definition('second')); await Promise.resolve();
  root = h.render(DictionaryModal, props);
  const labels = elements(root).map(n => n.props?.children);
  assert.ok(labels.includes('DICTIONARY EXAMPLE'));
  assert.ok(labels.includes('SELECTED BOOK PASSAGE'));
  labelled(root, 'Save definition to Lexicon Cards').onPress();
  assert.equal(saved[0].word, 'Second');
  assert.equal(saved[0].definition, 'Definition for second');
  assert.equal(saved[0].contextPassage, 'Exact text from my book.');
  assert.equal(saved[0].bookId, 'book-A');
  h.unmount();
});

test('pronunciation confirms native start/errors and stops on background or dictionary close', async () => {
  const { h, voices, toasts, stops } = dictionaryHarness();
  const { DictionaryModal } = h.load('../src/components/DictionaryModal.tsx');
  const props = { initialWord: 'quietude', bookId: 'book', onSaveToLexicon() {}, onClose() {}, showToast: text => toasts.push(text) };
  let root = h.render(DictionaryModal, props);
  root = h.render(DictionaryModal, props);
  await labelled(root, 'Pronounce English word').onPress();
  assert.equal(voices.length, 1);
  assert.equal(voices[0].word, 'quietude');
  assert.equal(toasts.length, 0);
  voices[0].options.onStart();
  assert.deepEqual(toasts, ['Pronouncing: quietude']);
  const priorStops = stops();
  h.appState('background');
  assert.equal(stops(), priorStops + 1);
  voices[0].options.onError();
  assert.equal(toasts.length, 1);
  h.appState('active');
  assert.equal(voices.length, 1);
  await labelled(root, 'Pronounce English word').onPress();
  voices[1].options.onError();
  assert.match(toasts.at(-1), /unavailable/);
  h.unmount();
  const count = toasts.length;
  voices[1].options.onStart();
  assert.equal(toasts.length, count);
  assert.equal(h.listeners.size, 0);
});

let highlightScope = 0;
const flushJobs = () => new Promise(resolve => setImmediate(resolve));
function savedHighlight(id, extra = {}) {
  return { id, bookId: 'book', bookTitle: 'A book', chapter: 'Arrival', page: 1, loc: 100, text: `Quote ${id}`, colorName: 'Amber Crayon', colorHex: '#F8E8A2', dateAdded: 'Added just now', ...extra };
}
function highlightHook() {
  const data = new Map(), uploaded = [], deleted = [], reports = [];
  const scope = `highlight-hook-${++highlightScope}.`;
  let writeFails = false, gate, remote = async () => null;
  const storage = {
    storageKey: key => scope + key,
    async loadJSONEntryStrict(key) {
      const raw = data.get(scope + key);
      return raw === undefined ? { present: false, value: null } : { present: true, value: JSON.parse(raw) };
    },
    async saveJSONStrict(key, value) {
      if (gate) await gate;
      if (writeFails) { writeFails = false; throw new Error('Storage full'); }
      data.set(scope + key, JSON.stringify(value));
    },
  };
  const cloud = {
    fetchHighlightsFromSupabase: () => remote(),
    async upsertHighlightToSupabase(entry) { uploaded.push(entry); return false; },
    async deleteHighlightFromSupabase(id) { deleted.push(id); return false; },
  };
  const h = harness({ runEffects: true });
  const { useHighlightArchive } = h.load('../src/lib/useHighlightArchive.ts');
  const hook = () => useHighlightArchive(storage, cloud, message => reports.push(message));
  return { h, hook, data, storage, cloud, uploaded, deleted, reports,
    legacy: items => data.set(scope + 'highlights', JSON.stringify(items)),
    failWrite: () => { writeFails = true; },
    blockWrite: () => { let resolve; gate = new Promise(ok => { resolve = ok; }); return resolve; },
    remote: fn => { remote = fn; },
  };
}

test('highlight hook never publishes success or starts cloud upload before storage acknowledges a save', async () => {
  const f = highlightHook(); f.legacy([savedHighlight('old')]);
  f.h.render(f.hook); await flushJobs();
  let result = f.h.render(f.hook);
  const release = f.blockWrite();
  const saving = result.add(savedHighlight('new'));
  await flushJobs();
  result = f.h.render(f.hook);
  assert.deepEqual(result.items.map(item => item.id), ['old']);
  assert.equal(result.busy, true);
  assert.equal(f.uploaded.length, 0);
  release();
  assert.equal(await saving, true);
  result = f.h.render(f.hook);
  assert.deepEqual(result.items.map(item => item.id), ['new', 'old']);
  assert.equal(result.busy, false);
  assert.equal(f.uploaded[0].id, 'new');
  f.h.unmount();
});

test('failed highlight writes retain saved state, report failure and do not upload; retry can succeed', async () => {
  const f = highlightHook(); f.legacy([savedHighlight('old', { note: 'Original' })]);
  f.h.render(f.hook); await flushJobs();
  let result = f.h.render(f.hook);
  f.failWrite();
  assert.equal(await result.note('old', 'Draft'), false);
  result = f.h.render(f.hook);
  assert.equal(result.items[0].note, 'Original');
  assert.equal(f.uploaded.length, 0);
  assert.match(result.notice, /could not be saved/);
  assert.equal(f.reports.length, 1);
  assert.equal(await result.note('old', 'Draft'), true);
  result = f.h.render(f.hook);
  assert.equal(result.items[0].note, 'Draft');
  assert.equal(result.notice, null);
  f.h.unmount();
});

test('unreadable highlight archives block mutation and remote merge until an explicit successful retry', async () => {
  const f = highlightHook();
  f.data.set(f.storage.storageKey('highlights'), 'null');
  let fetches = 0;
  f.remote(async () => { fetches++; return [savedHighlight('remote')]; });
  f.h.render(f.hook); await flushJobs();
  let result = f.h.render(f.hook);
  assert.equal(result.status, 'error');
  assert.equal(fetches, 0);
  assert.equal(await result.add(savedHighlight('new')), false);
  assert.equal(f.data.get(f.storage.storageKey('highlights')), 'null');
  assert.equal(f.data.has(f.storage.storageKey('highlightArchive')), false);
  f.legacy([savedHighlight('recovered')]);
  result.retry(); f.h.render(f.hook); await flushJobs();
  result = f.h.render(f.hook);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.items.map(item => item.id), ['recovered', 'remote']);
  f.h.unmount();
});

test('a late startup cloud response preserves notes edited and added while it was pending', async () => {
  const f = highlightHook(); f.legacy([savedHighlight('same', { note: 'Before' })]);
  let resolve;
  f.remote(() => new Promise(ok => { resolve = ok; }));
  f.h.render(f.hook); await flushJobs();
  let result = f.h.render(f.hook);
  assert.equal(await result.note('same', 'Offline edit'), true);
  assert.equal(await result.add(savedHighlight('local')), true);
  resolve([savedHighlight('same', { note: 'Stale server edit' }), savedHighlight('remote')]);
  await flushJobs();
  result = f.h.render(f.hook);
  assert.equal(result.items.find(item => item.id === 'same').note, 'Offline edit');
  assert.equal(result.items.length, 3);
  f.h.unmount();
});

test('unmounted note loaders ignore late cloud results without writing their archive', async () => {
  const f = highlightHook(); f.legacy([savedHighlight('local')]);
  let resolve;
  f.remote(() => new Promise(ok => { resolve = ok; }));
  f.h.render(f.hook); await flushJobs();
  const writes = f.h.stateWrites();
  f.h.unmount(); resolve([savedHighlight('remote')]); await flushJobs();
  assert.equal(f.h.stateWrites(), writes);
  assert.equal(f.data.has(f.storage.storageKey('highlightArchive')), false);
});

function notebookHarness(overrides = {}) {
  const h = harness({ runEffects: true, moduleMocks: {
    '../lib/supabase': { SUPABASE_SQL_SCHEMA: '' },
    'expo-clipboard': {}, 'expo-file-system': {}, 'expo-sharing': {}, 'expo-speech': {},
    './ui/Chip': { Chip: 'Chip' },
  } });
  const { NotebookView } = h.load('../src/components/NotebookView.tsx');
  const messages = [];
  const props = {
    cloud: {}, books: [{ id: 'book', title: 'A book', currentPage: 1, currentChapter: 'Arrival', currentLoc: 100 }],
    highlights: [], lexicon: [], highlightStatus: 'ready', highlightNotice: null, highlightBusy: false,
    onRetryHighlights() {}, onJumpToReader() {}, onOpenFlashcard() {}, bottomInset: 0,
    onAddHighlight: async () => true, onAddReflectionNote: async () => true, onDeleteHighlight: async () => true,
    showToast: message => messages.push(message), ...overrides,
  };
  return { h, NotebookView, props, messages };
}

test('Notebook retains a new quote draft on failed save, blocks duplicates, and closes only after confirmed save', async () => {
  let resolve, calls = 0;
  const f = notebookHarness({ onAddHighlight: () => { calls++; return new Promise(ok => { resolve = ok; }); } });
  let root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'New quote').onPress(); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Quote text').onChangeText('My exact draft'); root = f.h.render(f.NotebookView, f.props);
  const saving = labelled(root, 'Save new highlight').onPress();
  labelled(root, 'Save new highlight').onPress();
  root = f.h.render(f.NotebookView, f.props);
  assert.equal(calls, 1);
  assert.equal(labelled(root, 'Save new highlight').disabled, true);
  assert.equal(labelled(root, 'Quote text').value, 'My exact draft');
  assert.equal(f.messages.length, 0);
  resolve(false); await saving; root = f.h.render(f.NotebookView, f.props);
  assert.equal(labelled(root, 'Quote text').value, 'My exact draft');
  assert.equal(f.messages.length, 0);
  const retry = labelled(root, 'Save new highlight').onPress(); resolve(true); await retry;
  root = f.h.render(f.NotebookView, f.props);
  assert.ok(!elements(root).some(node => node.props?.accessibilityLabel === 'Quote text'));
  assert.deepEqual(f.messages, ['Highlight saved on this device']);
  f.h.unmount();
});

test('Notebook read failures offer Retry and disable new quotes/export/upload without claiming an empty archive', () => {
  let retried = false;
  const f = notebookHarness({ highlightStatus: 'error', highlightNotice: 'Saved highlights could not be loaded.', onRetryHighlights: () => { retried = true; } });
  const root = f.h.render(f.NotebookView, f.props);
  for (const label of ['New quote', 'Export notes', 'Upload current records']) assert.equal(labelled(root, label).disabled, true);
  assert.ok(!elements(root).some(node => node.props?.children === 'No highlights recorded yet.'));
  labelled(root, 'Retry loading saved highlights').onPress();
  assert.equal(retried, true);
  f.h.unmount();
});

test('Notebook reflection drafts remain editable after a failed save', async () => {
  const f = notebookHarness({ highlights: [savedHighlight('note')], onAddReflectionNote: async () => false });
  let root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Add reflection note').onPress(); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Reflection note').onChangeText('Keep this reflection'); root = f.h.render(f.NotebookView, f.props);
  await labelled(root, 'Save reflection note').onPress(); root = f.h.render(f.NotebookView, f.props);
  assert.equal(labelled(root, 'Reflection note').value, 'Keep this reflection');
  assert.equal(labelled(root, 'Reflection note').editable, true);
  assert.equal(f.messages.length, 0);
  f.h.unmount();
});

test('single-line save waits for confirmation and never reports a failed save as successful', async () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  let resolve, calls = 0;
  const messages = [];
  const props = lineReaderProps({ onAddHighlight: () => { calls++; return new Promise(ok => { resolve = ok; }); }, showToast: message => messages.push(message) });
  let root = h.render(SingleLineReader, props);
  const saving = labelled(root, 'Save current passage').onPress();
  labelled(root, 'Save current passage').onPress();
  root = h.render(SingleLineReader, props);
  assert.equal(labelled(root, 'Save current passage').disabled, true);
  assert.equal(calls, 1);
  assert.deepEqual(messages, []);
  resolve(false); await saving; root = h.render(SingleLineReader, props);
  assert.deepEqual(messages, []);
  assert.equal(wordControl(root).index, 0);
  const retry = labelled(root, 'Save current passage').onPress(); resolve(true); await retry;
  assert.deepEqual(messages, ['Passage saved on this device']);
  h.unmount();
});

test('passage reflection saves block duplicates and retain the selected text and draft after failure', async () => {
  const h = harness({ runEffects: true });
  const { PassageSheet } = h.load('../src/components/PassageSheet.tsx');
  let resolve, calls = 0, closed = false;
  const props = {
    text: 'A quiet garden.', initialSelection: 'quiet', onClose: () => { closed = true; },
    onHighlight: async () => true, onSaveNote: (selected, _color, note) => {
      calls++; assert.equal(selected, 'quiet'); assert.equal(note, 'Retain this draft');
      return new Promise(ok => { resolve = ok; });
    }, onDefine() {}, onCopy() {},
  };
  let root = h.render(PassageSheet, props);
  elements(root).find(node => node.props?.label === 'Note').props.onPress();
  root = h.render(PassageSheet, props);
  labelled(root, 'Reflection note').onChangeText('Retain this draft'); root = h.render(PassageSheet, props);
  const saving = labelled(root, 'Save reflection note').onPress();
  labelled(root, 'Save reflection note').onPress();
  root = h.render(PassageSheet, props);
  assert.equal(calls, 1);
  assert.equal(labelled(root, 'Save reflection note').disabled, true);
  assert.equal(labelled(root, 'Reflection note').editable, false);
  resolve(false); await saving; root = h.render(PassageSheet, props);
  assert.equal(closed, false);
  assert.equal(labelled(root, 'Reflection note').value, 'Retain this draft');
  assert.equal(labelled(root, 'Reflection note').editable, true);
  h.unmount();
});
