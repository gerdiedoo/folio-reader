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
  const react = {
    ...React,
    useMemo: fn => fn(),
    useCallback: fn => fn,
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
