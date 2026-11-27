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
  const backListeners = new Set();
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
    useWindowDimensions: () => ({ width: 400, height: 800, fontScale: 1 }),
    PanResponder: { create: handlers => ({ panHandlers: handlers }) },
    FlatList: 'FlatList', SectionList: 'SectionList', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator',
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
    BackHandler: { addEventListener(_event, callback) { backListeners.add(callback); return { remove: () => backListeners.delete(callback) }; } },
    AppState: { currentState: 'active', addEventListener(_event, callback) { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } },
  };
  const dependencies = {
    react,
    'react-native': native,
    'expo-haptics': { AndroidHaptics: { Long_Press: 'long-press' }, ImpactFeedbackStyle: { Light: 'light' }, performAndroidHapticsAsync: async () => {}, impactAsync: async () => {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../AppTheme': { useAppTheme: () => palette },
    '../../AppTheme': { useAppTheme: () => palette },
    '../MotionPreferences': { useReducedMotion: () => reducedMotion },
    '../../MotionPreferences': { useReducedMotion: () => reducedMotion },
    '../theme': theme, '../../theme': theme,
    './ui/Icon': { Icon: 'Icon' }, './ui/ModalShell': { ModalShell: 'ModalShell' },
    './ui/SeekBar': { SeekBar: 'SeekBar' },
    './CoverIllustration': { CoverIllustration: 'CoverIllustration' },
    'react-native-svg': { default: 'Svg', Circle: 'Circle', Path: 'Path', Rect: 'Rect' },
    './Icon': { Icon: 'Icon' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'MaterialCommunityIcons', MaterialIcons: 'MaterialIcons' },
    __clock: class extends Date { constructor(...args) { if (args.length) super(...args); else super(now); } static now() { return now; } },
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
      if (name.endsWith('.png')) return { bundledAsset: path.resolve(path.dirname(filename), name) };
      if (name.startsWith('.')) { const target = path.resolve(path.dirname(filename), name); return load(path.relative(__dirname, target) + (fs.existsSync(target + '.ts') ? '.ts' : '.tsx')); }
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
    hardwareBack() { for (const handler of backListeners) if (handler()) return true; return false; },
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
  return [root, ...elements(root.props?.children), ...elements(root.props?.ListHeaderComponent), ...(root.props?.testID === 'library-collection' ? [...elements(root.props.data.length ? null : root.props.ListEmptyComponent), ...root.props.data.flatMap((item, index) => elements(root.props.renderItem({ item, index })))] : [])];
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
    const props = { settings: { ...INITIAL_SETTINGS, fontSizeStep: start }, onSave: async s => { saved = s; return true; }, onClose() {} };
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
    initialPageNumber: 1, onPositionChange() {},
    settings: { theme: 'parchment', font: 'Literata', wpm: 240 },
    onExit() {}, onAddHighlight: async () => true, showToast() {}, ...overrides,
  };
}
function wordControl(root) { return elements(root).find(node => node.type === 'SeekBar').props; }

test('single-line playback waits for Play, reports source passages and stops at chapter end', () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  const passages = [];
  const props = lineReaderProps({ onPositionChange: (p, word) => passages.push([p.pageNumber, word]) });
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
  assert.deepEqual(passages, [[1, 0], [1, 1], [2, 0], [2, 1]]);
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
  const props = { initialWord: 'first', contextPassage: 'Exact text from my book.', bookId: 'book-A', onSaveToLexicon: async entry => { saved.push(entry); return true; }, onClose() {}, showToast() {} };
  let root = h.render(DictionaryModal, props); h.tick();
  jobs[0].resolve(definition('first')); await Promise.resolve();
  root = h.render(DictionaryModal, props);
  assert.equal(labelled(root, 'Save definition to Lexicon Cards').disabled, false);
  labelled(root, 'English dictionary word').onChangeText('second');
  root = h.render(DictionaryModal, props);
  assert.equal(labelled(root, 'Save definition to Lexicon Cards').disabled, true);
  await labelled(root, 'Save definition to Lexicon Cards').onPress();
  assert.equal(saved.length, 0);
  assert.ok(!elements(root).some(n => n.props?.children === 'Definition for first'));
  h.tick(); jobs[1].resolve(definition('second')); await Promise.resolve();
  root = h.render(DictionaryModal, props);
  const labels = elements(root).map(n => n.props?.children);
  assert.ok(labels.includes('DICTIONARY EXAMPLE'));
  assert.ok(labels.includes('SELECTED BOOK PASSAGE'));
  await labelled(root, 'Save definition to Lexicon Cards').onPress();
  assert.equal(saved[0].word, 'Second');
  assert.equal(saved[0].definition, 'Definition for second');
  assert.equal(saved[0].contextPassage, 'Exact text from my book.');
  assert.equal(saved[0].bookId, 'book-A');
  h.unmount();
});

test('pronunciation confirms native start/errors and stops on background or dictionary close', async () => {
  const { h, voices, toasts, stops } = dictionaryHarness();
  const { DictionaryModal } = h.load('../src/components/DictionaryModal.tsx');
  const props = { initialWord: 'quietude', bookId: 'book', onSaveToLexicon: async () => true, onClose() {}, showToast: text => toasts.push(text) };
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
    vocabularyStatus: 'ready', vocabularyNotice: null, vocabularyBusy: false, onRetryVocabulary() {},
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

let vocabularyScope = 0;
const vocabularyCard = (id, extra = {}) => ({ id, bookId: 'book', word: 'Quietude', phonetic: '/word/', partOfSpeech: 'noun', definition: 'Calmness.', contextPassage: 'The quietude of the garden.', chapter: 'Arrival', masteryLevel: 1, ...extra });
function vocabularyHook() {
  const data = new Map(), uploaded = [], reports = [];
  const scope = `vocabulary-hook-${++vocabularyScope}.`;
  let fail = false, gate, remote = async () => null;
  const storage = {
    storageKey: key => scope + key,
    async loadJSONEntryStrict(key) {
      const raw = data.get(scope + key);
      return raw === undefined ? { present: false, value: null } : { present: true, value: JSON.parse(raw) };
    },
    async saveJSONStrict(key, value) {
      if (gate) await gate;
      if (fail) { fail = false; throw new Error('Storage full'); }
      data.set(scope + key, JSON.stringify(value));
    },
  };
  const cloud = {
    fetchLexiconFromSupabase: () => remote(),
    async upsertLexiconToSupabase(entry) { uploaded.push(entry); return false; },
  };
  const h = harness({ runEffects: true });
  const { useLexiconArchive } = h.load('../src/lib/useLexiconArchive.ts');
  return { h, hook: () => useLexiconArchive(storage, cloud, message => reports.push(message)), data, storage, uploaded, reports,
    legacy: cards => data.set(scope + 'lexicon', JSON.stringify(cards)),
    failWrite: () => { fail = true; },
    remote: fn => { remote = fn; },
    blockWrite: () => { let release; gate = new Promise(ok => { release = ok; }); return release; },
  };
}

test('vocabulary hook confirms local storage before showing a card or uploading it', async () => {
  const f = vocabularyHook(); f.legacy([vocabularyCard('old')]);
  f.h.render(f.hook); await flushJobs();
  let result = f.h.render(f.hook);
  const release = f.blockWrite();
  const pending = result.add(vocabularyCard('new'));
  await flushJobs(); result = f.h.render(f.hook);
  assert.equal(result.busy, true);
  assert.deepEqual(result.items.map(item => item.id), ['old']);
  assert.equal(f.uploaded.length, 0);
  release(); assert.equal(await pending, true);
  result = f.h.render(f.hook);
  assert.deepEqual(result.items.map(item => item.id), ['new', 'old']);
  assert.equal(result.busy, false);
  assert.equal(f.uploaded[0].id, 'new');
  f.h.unmount();
});

test('failed mastery storage preserves the saved level and retry succeeds without a false cloud success', async () => {
  const f = vocabularyHook(); f.legacy([vocabularyCard('old')]);
  f.h.render(f.hook); await flushJobs(); let result = f.h.render(f.hook);
  f.failWrite(); assert.equal(await result.mastery('old', 5), false);
  result = f.h.render(f.hook);
  assert.equal(result.items[0].masteryLevel, 1);
  assert.equal(f.uploaded.length, 0);
  assert.equal(f.reports.length, 1);
  assert.match(result.notice, /could not be saved/);
  assert.equal(await result.mastery('old', 5), true);
  result = f.h.render(f.hook);
  assert.equal(result.items[0].masteryLevel, 5);
  assert.equal(result.notice, null);
  f.h.unmount();
});

test('unreadable vocabulary blocks cloud merge and mutation until retry reads valid data', async () => {
  const f = vocabularyHook(); f.data.set(f.storage.storageKey('lexicon'), 'null');
  let reads = 0;
  f.remote(async () => { reads++; return [vocabularyCard('cloud')]; });
  f.h.render(f.hook); await flushJobs(); let result = f.h.render(f.hook);
  assert.equal(result.status, 'error');
  assert.equal(reads, 0);
  assert.equal(await result.add(vocabularyCard('new')), false);
  assert.equal(f.data.get(f.storage.storageKey('lexicon')), 'null');
  assert.equal(f.data.has(f.storage.storageKey('lexiconArchive')), false);
  f.legacy([vocabularyCard('local')]); result.retry(); f.h.render(f.hook); await flushJobs();
  result = f.h.render(f.hook);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.items.map(item => item.id), ['local', 'cloud']);
  f.h.unmount();
});

test('late cloud vocabulary cannot replace mastery changed or cards added while loading', async () => {
  const f = vocabularyHook(); f.legacy([vocabularyCard('same')]);
  let resolve;
  f.remote(() => new Promise(ok => { resolve = ok; }));
  f.h.render(f.hook); await flushJobs(); let result = f.h.render(f.hook);
  assert.equal(await result.mastery('same', 5), true);
  assert.equal(await result.add(vocabularyCard('offline')), true);
  resolve([vocabularyCard('same', { masteryLevel: 1 }), vocabularyCard('remote')]); await flushJobs();
  result = f.h.render(f.hook);
  assert.equal(result.items.find(item => item.id === 'same').masteryLevel, 5);
  assert.equal(result.items.length, 3);
  f.h.unmount();
});

test('an unmounted vocabulary loader ignores delayed cloud results without writing data or UI state', async () => {
  const f = vocabularyHook(); f.legacy([vocabularyCard('local')]);
  let resolve;
  f.remote(() => new Promise(ok => { resolve = ok; }));
  f.h.render(f.hook); await flushJobs();
  const writes = f.h.stateWrites(); f.h.unmount(); resolve([vocabularyCard('remote')]); await flushJobs();
  assert.equal(f.h.stateWrites(), writes);
  assert.equal(f.data.has(f.storage.storageKey('lexiconArchive')), false);
});

test('dictionary card Save waits for acknowledgement, prevents duplicates and retains a failed definition for retry', async () => {
  const { h, toasts } = dictionaryHarness();
  const { DictionaryModal } = h.load('../src/components/DictionaryModal.tsx');
  let resolve, calls = 0, closed = 0;
  const props = { initialWord: 'quietude', bookId: 'book', onClose: () => { closed++; }, showToast: text => toasts.push(text),
    onSaveToLexicon: () => { calls++; return new Promise(ok => { resolve = ok; }); } };
  let root = h.render(DictionaryModal, props); root = h.render(DictionaryModal, props);
  const saving = labelled(root, 'Save definition to Lexicon Cards').onPress();
  labelled(root, 'Save definition to Lexicon Cards').onPress(); root = h.render(DictionaryModal, props);
  assert.equal(calls, 1);
  assert.equal(closed, 0);
  assert.deepEqual(toasts, []);
  assert.equal(labelled(root, 'English dictionary word').editable, false);
  assert.equal(labelled(root, 'Save definition to Lexicon Cards').disabled, true);
  resolve(false); await saving; root = h.render(DictionaryModal, props);
  assert.equal(closed, 0);
  assert.equal(labelled(root, 'English dictionary word').value, 'quietude');
  assert.ok(elements(root).some(node => typeof node.props?.children === 'string' && node.props.children.includes('Couldn’t save this card')));
  const retry = labelled(root, 'Save definition to Lexicon Cards').onPress(); resolve(true); await retry;
  assert.equal(closed, 1);
  assert.deepEqual(toasts, ['Saved "quietude" on this device']);
  h.unmount();
});

test('mastery ratings stay pending until confirmed and a failed save keeps the revealed card open', async () => {
  const h = harness({ runEffects: true });
  const { FlashcardModal } = h.load('../src/components/FlashcardModal.tsx');
  let resolve, calls = 0, closed = 0;
  const toasts = [];
  const props = { lexiconItem: vocabularyCard('word'), onClose: () => { closed++; }, showToast: text => toasts.push(text),
    onUpdateMastery: (id, level) => { assert.equal(id, 'word'); calls++; return new Promise(ok => { resolve = ok; }); } };
  let root = h.render(FlashcardModal, props);
  labelled(root, 'Reveal definition for Quietude').onPress(); root = h.render(FlashcardModal, props);
  const saving = labelled(root, 'Mastered: mastery 5 of 5').onPress();
  labelled(root, 'Good: mastery 3 of 5').onPress(); root = h.render(FlashcardModal, props);
  assert.equal(calls, 1);
  assert.equal(labelled(root, 'Mastered: mastery 5 of 5').disabled, true);
  assert.equal(closed, 0); assert.deepEqual(toasts, []);
  resolve(false); await saving; root = h.render(FlashcardModal, props);
  assert.equal(closed, 0);
  assert.ok(elements(root).some(node => node.props?.children === 'Calmness.'));
  assert.ok(elements(root).some(node => typeof node.props?.children === 'string' && node.props.children.includes('Couldn’t save mastery')));
  const retry = labelled(root, 'Good: mastery 3 of 5').onPress(); resolve(true); await retry;
  assert.equal(closed, 1);
  assert.deepEqual(toasts, ['Mastery level 3/5 saved on this device']);
  h.unmount();
});

test('unreadable vocabulary disables export/upload and offers Retry without blocking note creation', () => {
  let retried = false;
  const f = notebookHarness({ vocabularyStatus: 'error', vocabularyNotice: 'Saved vocabulary could not be loaded.', onRetryVocabulary: () => { retried = true; } });
  const root = f.h.render(f.NotebookView, f.props);
  assert.equal(labelled(root, 'New quote').disabled, false);
  for (const label of ['Export notes', 'Upload current records']) assert.equal(labelled(root, label).disabled, true);
  labelled(root, 'Retry loading saved vocabulary').onPress(); assert.equal(retried, true);
  f.h.unmount();
});

test('dictionary and mastery controls cannot commit while saved vocabulary is unavailable', async () => {
  for (const saveStatus of ['loading', 'error']) {
    const { h } = dictionaryHarness();
    const { DictionaryModal } = h.load('../src/components/DictionaryModal.tsx');
    const props = { initialWord: 'quietude', bookId: 'book', saveStatus, onClose() {}, showToast() {}, onSaveToLexicon: async () => assert.fail('Unexpected Save') };
    h.render(DictionaryModal, props); const root = h.render(DictionaryModal, props);
    assert.equal(labelled(root, 'Save definition to Lexicon Cards').disabled, true);
    await labelled(root, 'Save definition to Lexicon Cards').onPress(); h.unmount();
    const other = harness({ runEffects: true });
    const { FlashcardModal } = other.load('../src/components/FlashcardModal.tsx');
    const card = other.render(FlashcardModal, { lexiconItem: vocabularyCard('word'), saveStatus, onClose() {}, showToast() {}, onUpdateMastery: async () => assert.fail('Unexpected rating') });
    assert.equal(labelled(card, 'Mastered: mastery 5 of 5').disabled, true);
    await labelled(card, 'Mastered: mastery 5 of 5').onPress(); other.unmount();
  }
});

let preferencesScope = 0;
function preferencesHook() {
  const data = new Map(), uploaded = [], reports = [];
  const scope = `preferences-hook-${++preferencesScope}.`;
  let failRead = false, failWrite = false, gate, remote = async () => null, fetches = 0;
  const storage = {
    storageKey: key => scope + key,
    async loadJSONEntryStrict(key) {
      if (failRead) throw new Error('Read failure');
      const raw = data.get(scope + key);
      return raw === undefined ? { present: false, value: null } : { present: true, value: JSON.parse(raw) };
    },
    async saveJSONStrict(key, value) {
      if (gate) await gate;
      if (failWrite) { failWrite = false; throw new Error('Storage full'); }
      data.set(scope + key, JSON.stringify(value));
    },
  };
  const cloud = {
    fetchReadingSettingsFromSupabase: () => { fetches++; return remote(); },
    async upsertReadingSettingsToSupabase(settings) { uploaded.push(settings); return false; },
  };
  const h = harness({ runEffects: true });
  const { useReaderSettings } = h.load('../src/lib/useReaderSettings.ts');
  return { h, hook: () => useReaderSettings(storage, cloud, message => reports.push(message)), data, storage, uploaded, reports,
    legacy: value => data.set(scope + 'settings', JSON.stringify(value)),
    failRead: value => { failRead = value; }, failWrite: () => { failWrite = true; },
    remote: fn => { remote = fn; }, fetches: () => fetches,
    blockWrite: () => { let release; gate = new Promise(ok => { release = ok; }); return release; },
  };
}

test('preference hook confirms storage before changing appearance or uploading and retains confirmed choices on failure', async () => {
  const f = preferencesHook(); f.legacy({ theme: 'sepia' });
  f.h.render(f.hook); await flushJobs(); let result = f.h.render(f.hook);
  const release = f.blockWrite(); const saving = result.patch({ theme: 'charcoal' });
  await flushJobs(); result = f.h.render(f.hook);
  assert.equal(result.busy, true); assert.equal(result.settings.theme, 'sepia'); assert.equal(f.uploaded.length, 0);
  release(); assert.equal(await saving, true); await flushJobs(); result = f.h.render(f.hook);
  assert.equal(result.busy, false); assert.equal(result.settings.theme, 'charcoal'); assert.equal(f.uploaded.length, 1);
  f.failWrite(); assert.equal(await result.patch({ theme: 'white' }), false);
  result = f.h.render(f.hook);
  assert.equal(result.settings.theme, 'charcoal'); assert.match(result.notice, /could not be saved/);
  assert.equal(f.uploaded.length, 1); assert.equal(f.reports.length, 1);
  assert.equal(await result.patch({ theme: 'white' }), true); result = f.h.render(f.hook);
  assert.equal(result.settings.theme, 'white'); assert.equal(result.notice, null);
  f.h.unmount();
});

test('unreadable preferences block changes and cloud import until an explicit retry succeeds', async () => {
  const f = preferencesHook(); f.failRead(true);
  let result = f.h.render(f.hook);
  assert.equal(await result.patch({ theme: 'white' }), false);
  await flushJobs(); result = f.h.render(f.hook);
  assert.equal(result.status, 'error'); assert.equal(f.fetches(), 0);
  assert.equal(await result.patch({ theme: 'white' }), false); assert.equal(f.data.size, 0);
  f.failRead(false); f.legacy({ theme: 'sepia' }); result.retry();
  f.h.render(f.hook); await flushJobs(); result = f.h.render(f.hook);
  assert.equal(result.status, 'ready'); assert.equal(result.settings.theme, 'sepia'); assert.equal(f.fetches(), 0);
  f.h.unmount();
});

test('late cloud preferences cannot replace choices already confirmed on the device', async () => {
  const f = preferencesHook(); let resolve;
  f.remote(() => new Promise(ok => { resolve = ok; }));
  f.h.render(f.hook); await flushJobs(); let result = f.h.render(f.hook);
  assert.equal(result.status, 'ready');
  assert.equal(await result.patch({ theme: 'charcoal', readingFlowMode: 'paginated' }), true);
  resolve({ theme: 'white', fontSizeStep: 8 }); await flushJobs(); result = f.h.render(f.hook);
  assert.equal(result.settings.theme, 'charcoal'); assert.equal(result.settings.fontSizeStep, 4);
  assert.equal(result.settings.readingFlowMode, 'paginated'); f.h.unmount();
});

test('cloud preference seed waits for local storage and ignores delayed results after unmount', async () => {
  const f = preferencesHook(); f.remote(async () => ({ theme: 'charcoal' })); const release = f.blockWrite();
  f.h.render(f.hook); await flushJobs(); let result = f.h.render(f.hook);
  assert.equal(result.settings.theme, 'parchment'); assert.equal(f.data.size, 0);
  release(); await flushJobs(); result = f.h.render(f.hook);
  assert.equal(result.settings.theme, 'charcoal'); assert.equal(f.uploaded.length, 0); f.h.unmount();
  const other = preferencesHook(); let resolve;
  other.remote(() => new Promise(ok => { resolve = ok; }));
  other.h.render(other.hook); await flushJobs();
  const writes = other.h.stateWrites(); other.h.unmount(); resolve({ theme: 'white' }); await flushJobs();
  assert.equal(other.h.stateWrites(), writes); assert.equal(other.data.size, 0);
});

test('settings Keep Changes waits, rejects duplicate taps and retains the draft after a failed save', async () => {
  const h = harness({ runEffects: true });
  const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
  const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
  let resolve, calls = 0, closed = 0, changes;
  const props = { settings: INITIAL_SETTINGS, isSheetOnly: true, onClose: () => { closed++; },
    onSave: partial => { changes = partial; calls++; return new Promise(ok => { resolve = ok; }); } };
  let root = h.render(SettingsSheet, props);
  labelled(root, 'wide margins').onPress(); root = h.render(SettingsSheet, props);
  const saving = labelled(root, 'Keep Changes').onPress();
  labelled(root, 'Keep Changes').onPress(); root = h.render(SettingsSheet, props);
  assert.equal(calls, 1); assert.equal(closed, 0); assert.deepEqual(changes, { margins: 'wide' });
  assert.equal(labelled(root, 'Keep Changes').accessibilityState.busy, true);
  assert.equal(labelled(root, 'Close Settings').disabled, true);
  labelled(root, 'Close Settings').onPress();
  labelled(root, 'Increase text size').onPress(); root = h.render(SettingsSheet, props);
  assert.equal(closed, 0); assert.equal(labelled(root, 'Text size').accessibilityValue.now, 4);
  resolve(false); await saving; root = h.render(SettingsSheet, props);
  assert.equal(closed, 0); assert.equal(labelled(root, 'wide margins').accessibilityState.selected, true);
  assert.ok(elements(root).some(node => typeof node.props?.children === 'string' && node.props.children.includes('Your choices have been kept')));
  const retry = labelled(root, 'Keep Changes').onPress(); resolve(true); await retry;
  assert.equal(closed, 1); assert.equal(calls, 2); h.unmount();
});

test('settings draft follows newly loaded untouched fields and saves only fields the reader edited', async () => {
  const h = harness({ runEffects: true });
  const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
  const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
  let saved;
  let props = { settings: INITIAL_SETTINGS, onSave: async partial => { saved = partial; return true; }, onClose() {} };
  let root = h.render(SettingsSheet, props);
  labelled(root, 'wide margins').onPress(); root = h.render(SettingsSheet, props);
  props = { ...props, settings: { ...INITIAL_SETTINGS, font: 'Manrope', margins: 'narrow', fontSizeStep: 7 } };
  h.render(SettingsSheet, props); root = h.render(SettingsSheet, props);
  assert.equal(labelled(root, 'Manrope typeface').accessibilityState.selected, true);
  assert.equal(labelled(root, 'wide margins').accessibilityState.selected, true);
  assert.equal(labelled(root, 'Text size').accessibilityValue.now, 7);
  await labelled(root, 'Keep Changes').onPress(); assert.deepEqual(saved, { margins: 'wide' }); h.unmount();
});

test('settings loading/error states prevent commits and expose a persistent retry action', async () => {
  for (const saveStatus of ['loading', 'error']) {
    const h = harness({ runEffects: true });
    const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
    const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
    let retried = false;
    const props = { settings: INITIAL_SETTINGS, saveStatus, saveNotice: 'Saved preferences could not be loaded.',
      onSave: async () => assert.fail('Unexpected save'), onClose() {}, onRetry: () => { retried = true; } };
    const root = h.render(SettingsSheet, props);
    assert.equal(labelled(root, 'Keep Changes').disabled, true);
    await labelled(root, 'Keep Changes').onPress();
    if (saveStatus === 'error') { labelled(root, 'Try loading reading preferences again').onPress(); assert.equal(retried, true); }
    h.unmount();
  }
});

test('Reset Defaults remains a draft until Keep Changes and an exception keeps it available for retry', async () => {
  const h = harness({ runEffects: true });
  const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
  const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
  let calls = 0, closed = false;
  const props = { settings: { ...INITIAL_SETTINGS, fontSizeStep: 8 }, onSave: async changes => { calls++; assert.deepEqual(changes, INITIAL_SETTINGS); throw new Error('Storage'); }, onClose: () => { closed = true; } };
  let root = h.render(SettingsSheet, props);
  labelled(root, 'Reset Defaults').onPress(); root = h.render(SettingsSheet, props);
  assert.equal(calls, 0); assert.equal(labelled(root, 'Text size').accessibilityValue.now, 4);
  await labelled(root, 'Keep Changes').onPress(); root = h.render(SettingsSheet, props);
  assert.equal(calls, 1); assert.equal(closed, false); assert.equal(labelled(root, 'Keep Changes').disabled, false); h.unmount();
});

test('leaving Settings while a save is pending does not reopen it or update the unmounted sheet', async () => {
  const h = harness({ runEffects: true });
  const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
  const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
  let resolve, closed = false;
  const props = { settings: INITIAL_SETTINGS, onSave: () => new Promise(ok => { resolve = ok; }), onClose: () => { closed = true; } };
  const root = h.render(SettingsSheet, props);
  const pending = labelled(root, 'Keep Changes').onPress();
  h.unmount(); const writes = h.stateWrites(); resolve(true); await pending;
  assert.equal(closed, false); assert.equal(h.stateWrites(), writes);
});

test('Return to pages immediately pauses Line while the reading-mode save is pending or fails', () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  let requested = false;
  const props = lineReaderProps({ onExit: () => { requested = true; return Promise.resolve(false); } });
  let root = h.render(SingleLineReader, props);
  labelled(root, 'Play chapter').onPress(); root = h.render(SingleLineReader, props);
  assert.equal(h.timers.size, 1);
  labelled(root, 'Return to pages').onPress();
  assert.equal(requested, true); assert.equal(h.timers.size, 0);
  root = h.render(SingleLineReader, props);
  assert.equal(labelled(root, 'Play chapter').disabled, false); assert.equal(h.timers.size, 0);
  h.unmount();
});

function scrollingReader(extra = {}) {
  const h = harness({ runEffects: true, moduleMocks: {
    'expo-clipboard': { setStringAsync: async () => {} },
    './BookmarkSheet': { BookmarkSheet: 'BookmarkSheet' },
    './BookSearchSheet': { BookSearchSheet: 'BookSearchSheet' },
    './PassageSheet': { PassageSheet: 'PassageSheet' },
    './ReaderNavigator': { ChapterSheet: 'ChapterSheet', ScrubBar: 'ScrubBar' },
    './SingleLineReader': { SingleLineReader: 'SingleLineReader' },
    './ui/ProgressBar': { ProgressBar: 'ProgressBar' },
  } });
  const { ReaderView } = h.load('../src/components/ReaderView.tsx');
  const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
  const positions = [], restored = [];
  const pages = Array.from({ length: 12 }, (_, index) => ({ pageNumber: index + 1, chapterNumber: String(Math.floor(index / 3) + 1),
    chapterTitle: 'Chapter', folioNumber: 'I', dropCap: 'A', paragraph1: ' long paragraph to read.', paragraph2Lead: 'More words.', highlightedText: '', paragraph2Rest: '',
    totalBookPages: 12, locNumber: (index + 1) * 100, totalLoc: 1200, minutesLeftInChapter: 1 }));
  let props = { currentBook: { id: 'reading-book', title: 'Read me', currentPage: 8, currentLoc: 800, totalPages: 12, progressPercent: 67 },
    customPages: pages, settings: INITIAL_SETTINGS, highlights: [], bookmarks: [], bookmarkStatus: 'ready', bookmarkSaving: false,
    onUpdateReadingPosition: (bookId, page, total, position) => positions.push({ bookId, page, total, position }),
    onUpdateSettings: async () => true, onOpenSettingsSheet() {}, onOpenDictionary() {},
    onAddHighlight: async () => true, onDeleteHighlight: async () => true, onAddReflectionNote: async () => true,
    onRetryBookmarks() {}, onRemoveBookmark() {}, onToggleBookmark() {}, isNavVisible: true, isImmersiveMode: false,
    onToggleNavVisibility() {}, setNavVisibility() {}, showToast() {}, bottomSpace: 0, playbackBlocked: false,
    ...extra };
  let root;
  const render = () => { root = h.render(ReaderView, props); return root; };
  const list = () => elements(root).find(node => node.type === 'FlatList').props;
  const settle = () => { for (let i = 0; i < 3; i++) render(); const scroll = elements(root).find(node => node.type === 'FlatList')?.props; if (scroll?.ref) scroll.ref.current = { scrollToOffset: value => restored.push(value) }; };
  settle();
  const measure = (pageNumber, y, height) => {
    const current = list();
    const index = current.data.findIndex(page => page.pageNumber === pageNumber);
    assert.ok(index >= 0, 'Cell must belong to the current scroll window');
    const cell = current.CellRendererComponent({ item: current.data[index], index, children: null });
    cell.props.onLayout({ nativeEvent: { layout: { y, height, x: 0, width: 360 } } });
  };
  const viewport = (height = 650, content = 4000) => {
    list().onLayout({ nativeEvent: { layout: { width: 360, height } } });
    list().onContentSizeChange(360, content);
  };
  return { h, pages, positions, restored, render, list, settle, measure, viewport,
    root: () => root, props: () => props, change: next => { props = { ...props, ...next }; settle(); } };
}
const scrolled = y => ({ nativeEvent: { contentOffset: { y } } });

test('reopening Scroll never prepends earlier passages or reports layout-only movement as reading', () => {
  const f = scrollingReader();
  f.viewport(); f.measure(8, 84, 1500); f.measure(9, 1584, 1400);
  assert.equal(f.list().data[0].pageNumber, 8);
  assert.equal(f.list().onStartReached, undefined);
  for (const y of [0, 84, 0]) f.list().onScroll(scrolled(y));
  assert.equal(f.positions.length, 0);
  f.h.unmount(); assert.equal(f.positions.length, 0);
});

test('closing Scroll flushes its exact intra-passage offset before debounce and reopening restores it', () => {
  const f = scrollingReader(); f.viewport(); f.measure(8, 84, 1500); f.measure(9, 1584, 1400);
  f.list().onScrollBeginDrag(scrolled(84)); f.list().onScroll(scrolled(545));
  assert.equal(f.positions.length, 0);
  f.h.unmount();
  assert.equal(f.positions.length, 1);
  const saved = f.positions[0];
  assert.equal(saved.page.pageNumber, 8); assert.equal(saved.position.scroll.offset, 461);
  const next = scrollingReader({ currentBook: { ...f.props().currentBook, readingPosition: saved.position } });
  next.viewport(); next.measure(8, 84, 1500);
  assert.deepEqual(next.restored.at(-1), { offset: 545, animated: false });
  next.list().onScroll(scrolled(545)); next.h.unmount();
  assert.equal(next.positions.length, 0, 'Restoration must not overwrite the stored position');
});

test('Scroll tracks long passages and source identity through momentum, then saves the final offset', () => {
  const f = scrollingReader(); f.viewport(); f.measure(8, 84, 3000); f.measure(9, 3084, 1400);
  f.list().onMomentumScrollBegin(scrolled(1500));
  f.list().onScroll(scrolled(3300)); f.list().onMomentumScrollEnd(scrolled(3400));
  assert.equal(f.positions.length, 1);
  assert.equal(f.positions[0].page.pageNumber, 9); assert.equal(f.positions[0].position.scroll.offset, 316);
  assert.equal(f.positions[0].page.locNumber, 900);
  f.h.unmount();
});

test('late measured cells capture the current viewport and backgrounding flushes it', () => {
  const f = scrollingReader(); f.viewport(); f.list().onScrollBeginDrag(scrolled(84)); f.list().onScroll(scrolled(700));
  f.measure(8, 84, 1500); f.h.appState('background');
  assert.equal(f.positions.length, 1); assert.equal(f.positions[0].position.scroll.offset, 616);
  f.h.unmount();
});

test('earlier passages require an explicit action and stale callbacks from the old list cannot rewind or advance it', () => {
  const f = scrollingReader(); f.viewport(); f.measure(8, 84, 1500);
  const old = f.list();
  old.onScrollBeginDrag(scrolled(84)); old.onScroll(scrolled(600));
  labelled(f.list().ListHeaderComponent, 'Read previous passage').onPress(); f.settle();
  assert.equal(f.list().data[0].pageNumber, 7);
  old.onScrollBeginDrag(scrolled(0)); old.onScroll(scrolled(1200)); old.onMomentumScrollEnd(scrolled(1200));
  f.h.unmount();
  assert.equal(f.positions.at(-1).page.pageNumber, 7);
  assert.equal(f.positions.at(-1).position.scroll, undefined);
});

test('obsolete pixel offsets are not reused after typography changes; the source passage remains selected', () => {
  const f = scrollingReader({ currentBook: { id: 'reading-book', title: 'Read me', currentPage: 8,
    readingPosition: { pageNumber: 8, scroll: { offset: 800, layout: 'old-font-and-width' } } } });
  f.viewport(); f.measure(8, 84, 1500);
  assert.equal(f.restored.length, 0); assert.equal(f.list().data[0].pageNumber, 8);
  f.h.unmount(); assert.equal(f.positions.length, 0);
});

test('Notebook jumps are acknowledged once and reopening Reading uses the later saved passage', () => {
  let handled;
  const f = scrollingReader({ jumpTarget: { bookId: 'reading-book', page: 3, nonce: 456 }, onJumpHandled: nonce => { handled = nonce; } });
  assert.equal(handled, 456); assert.equal(f.list().data[0].pageNumber, 3);
  f.change({ jumpTarget: null }); f.viewport(); f.measure(8, 84, 1500);
  f.list().onScrollBeginDrag(scrolled(84)); f.list().onScroll(scrolled(400)); f.h.unmount();
  const saved = f.positions.at(-1);
  const next = scrollingReader({ currentBook: { ...f.props().currentBook, currentPage: saved.page.pageNumber, readingPosition: saved.position }, jumpTarget: null });
  assert.equal(next.list().data[0].pageNumber, 8); next.h.unmount();
});

function preciseReader(mode, extra = {}) {
  const customPages = Array.from({ length: 12 }, (_, index) => page(index + 1,
    index === 7 ? Array.from({ length: 200 }, (_, word) => `word${word}`).join(' ') : `Source ${index + 1}.`));
  const settings = { theme: 'parchment', font: 'Literata', fontSizeStep: 4, lineSpacing: 'standard', margins: 'regular',
    usePublisherDefaults: false, displayReadingPace: false, readingFlowMode: mode };
  const f = scrollingReader({ customPages, settings, ...extra });
  const layout = (width = 400, height = 400) => {
    const surface = elements(f.root()).find(node => node.type === 'View' && typeof node.props.onLayout === 'function');
    assert.ok(surface, 'Pages must measure its surface');
    surface.props.onLayout({ nativeEvent: { layout: { width, height } } }); f.settle();
  };
  const visible = () => elements(f.root()).find(node => node.props?.page?.pageNumber && node.props?.textStyle)?.props.page;
  const text = () => { const p = visible(); return p.dropCap + p.paragraph1 + ' ' + p.paragraph2Lead + p.highlightedText + p.paragraph2Rest; };
  const line = () => elements(f.root()).find(node => node.type === 'SingleLineReader').props;
  return { ...f, layout, visible, text, line };
}

test('Pages saves a split passage word ordinal and reopens the same display page after measurement', () => {
  const f = preciseReader('paginated'); f.layout();
  labelled(f.root(), 'Next page').onPress(); f.settle();
  labelled(f.root(), 'Next page').onPress(); f.settle();
  const selected = f.text();
  assert.equal(f.visible().pageNumber, 8); assert.ok(!selected.split(/\s+/).includes('word0'));
  f.h.unmount();
  assert.equal(f.positions.length, 1);
  const saved = f.positions[0].position;
  assert.equal(saved.pageNumber, 8); assert.ok(saved.wordOffset > 0); assert.equal(saved.scroll, undefined);
  const next = preciseReader('paginated', { currentBook: { ...f.props().currentBook, readingPosition: saved } });
  next.layout(); assert.equal(next.text(), selected);
  assert.equal(next.positions.length, 0, 'Measured restoration must not rewrite the saved anchor'); next.h.unmount();
});

test('Pages preserves the saved word through viewport, text-size and system-scale reflow', () => {
  const f = preciseReader('paginated', { currentBook: { id: 'reading-book', currentPage: 8, title: 'Read me', readingPosition: { pageNumber: 8, wordOffset: 170 } } });
  const contains = () => assert.ok(f.text().split(/\s+/).includes('word170'));
  f.layout(); contains();
  f.layout(700, 700); contains();
  f.change({ settings: { ...f.props().settings, fontSizeStep: 8, margins: 'wide', lineSpacing: 'loose' } }); contains();
  f.h.native.useWindowDimensions = () => ({ width: 700, height: 700, fontScale: 1.7 }); f.settle(); contains();
  f.h.unmount(); assert.equal(f.positions.length, 0);
});

test('backward page turns remain intentional and Notebook jumps release an earlier word anchor', () => {
  const f = preciseReader('paginated', { currentBook: { id: 'reading-book', currentPage: 8, title: 'Read me', readingPosition: { pageNumber: 8, wordOffset: 100 } } });
  f.layout(); labelled(f.root(), 'Previous page').onPress(); f.settle();
  f.h.appState('background');
  assert.ok(f.positions.at(-1).position.wordOffset < 100);
  f.change({ jumpTarget: { bookId: 'reading-book', page: 8, nonce: 91 } });
  f.h.unmount(); assert.equal(f.positions.at(-1).position.wordOffset, 0);
});

test('Find in book persists its exact matched word through reflow instead of restarting the passage', () => {
  const f = preciseReader('paginated'); f.layout();
  elements(f.root()).find(node => node.props?.label === 'More').props.onPress(); f.settle();
  labelled(f.root(), 'Find in book').onPress(); f.settle();
  const sheet = elements(f.root()).find(node => node.type === 'BookSearchSheet');
  sheet.props.onSelect({ sourceIndex: 7, pageNumber: 8, wordIndex: 143 }); f.settle();
  assert.ok(f.text().split(/\s+/).includes('word143'));
  f.layout(700, 650); assert.ok(f.text().split(/\s+/).includes('word143'));
  f.h.unmount(); assert.equal(f.positions.at(-1).position.wordOffset, 143);
});

test('Line reopens at a saved word paused, and seeking/playback report offsets within the source passage', () => {
  const h = harness({ runEffects: true });
  const { SingleLineReader } = h.load('../src/components/SingleLineReader.tsx');
  const positions = [];
  const props = lineReaderProps({ chapterPages: [page(1, 'one two three four'), page(2, 'five six')],
    initialWordOffset: 2, onPositionChange: (source, wordOffset) => positions.push({ pageNumber: source.pageNumber, wordOffset }) });
  let root = h.render(SingleLineReader, props);
  assert.equal(wordControl(root).index, 2); assert.equal(h.timers.size, 0);
  labelled(root, 'Play chapter').onPress(); root = h.render(SingleLineReader, props);
  h.tick(); root = h.render(SingleLineReader, props);
  assert.deepEqual(positions.at(-1), { pageNumber: 1, wordOffset: 3 });
  wordControl(root).onChange(4); root = h.render(SingleLineReader, props);
  assert.deepEqual(positions.at(-1), { pageNumber: 2, wordOffset: 0 }); assert.equal(h.timers.size, 0);
  h.unmount();
  const next = harness({ runEffects: true });
  const { SingleLineReader: Reopened } = next.load('../src/components/SingleLineReader.tsx');
  const saved = next.render(Reopened, { ...props, initialPageNumber: 2, initialWordOffset: 1 });
  assert.equal(wordControl(saved).index, 5); assert.equal(next.timers.size, 0); next.unmount();
});

test('Reader forwards Line word positions, flushes on close and bounds continuous-playback save latency', () => {
  const f = preciseReader('single-line', { currentBook: { id: 'reading-book', title: 'Read me', currentPage: 8, readingPosition: { pageNumber: 8, wordOffset: 17 } } });
  assert.equal(f.line().initialWordOffset, 17);
  for (const offset of [18, 19, 20, 21]) f.line().onPositionChange(f.props().customPages[7], offset);
  assert.equal(f.positions.length, 0);
  const deadline = [...f.h.timers.values()].find(timer => timer.ms === 2000);
  assert.ok(deadline, 'Continuous word changes need a maximum save delay'); deadline.fn();
  assert.equal(f.positions.at(-1).position.wordOffset, 21);
  assert.equal(f.h.timers.size, 0);
  f.line().onPositionChange(f.props().customPages[7], 22); f.h.unmount();
  assert.equal(f.positions.at(-1).position.wordOffset, 22); assert.equal(f.h.timers.size, 0);
  const next = preciseReader('single-line', { currentBook: { ...f.props().currentBook, readingPosition: f.positions.at(-1).position } });
  assert.equal(next.line().initialWordOffset, 22); next.h.unmount();
});

test('Pages and Line hand off the same source word while Scroll retains its passage-based fallback', () => {
  const f = preciseReader('single-line', { currentBook: { id: 'reading-book', title: 'Read me', currentPage: 8, readingPosition: { pageNumber: 8, wordOffset: 73 } } });
  f.change({ settings: { ...f.props().settings, readingFlowMode: 'paginated' } }); f.layout();
  assert.ok(f.text().split(/\s+/).includes('word73'));
  f.change({ settings: { ...f.props().settings, readingFlowMode: 'single-line' } });
  assert.equal(f.line().initialWordOffset, 73);
  f.change({ settings: { ...f.props().settings, readingFlowMode: 'continuous' } });
  assert.equal(f.list().data[0].pageNumber, 8); f.h.unmount();
});

function removalEditor(onRemove, onClose = () => {}) {
  const h = harness({ runEffects: true, moduleMocks: {
    'expo-document-picker': {}, 'expo-image-picker': {},
    '../lib/epubParser': {}, './BrowseBooksScreen': { BrowseBooksScreen: 'BrowseBooksScreen' },
    './BookCover': { BookCover: 'BookCover', CLOTH: { parchment: { bg: '#fff' } } },
    './ui/Chip': { Chip: 'Chip' }, './ui/ProgressBar': { ProgressBar: 'ProgressBar' },
  } });
  const { BookRemovalDialog } = h.load('../src/components/BookRemovalDialog.tsx');
  const props = { title: 'A book', onRemove, onClose };
  const render = () => h.render(BookRemovalDialog, props);
  return { h, render, root: render() };
}

test('book removal waits for confirmation, blocks duplicate/cancel/dismiss actions and keeps failed confirmation open for retry', async () => {
  let resolve, calls = 0, closed = 0;
  const f = removalEditor(() => { calls++; return new Promise(done => { resolve = done; }); }, () => { closed++; });
  const label = 'Remove A book from Library';
  const pending = labelled(f.root, label).onPress();
  labelled(f.root, label).onPress();
  let root = f.render();
  assert.equal(calls, 1); assert.equal(closed, 0);
  assert.deepEqual(labelled(root, label).accessibilityState, { disabled: true, busy: true });
  assert.equal(labelled(root, 'Keep this book').disabled, true);
  labelled(root, 'Keep this book').onPress(); root.props.onClose();
  assert.equal(closed, 0);
  resolve({ removed: false, message: 'Book kept because the library could not be saved. Notes were already removed.' });
  await pending; root = f.render();
  assert.equal(closed, 0); assert.equal(labelled(root, label).disabled, false);
  const error = elements(root).find(node => node.props?.accessibilityRole === 'alert');
  assert.match(error.props.children, /Book kept.*Notes were already removed/);
  const retry = labelled(root, label).onPress(); resolve({ removed: true, message: 'Removed on this device' }); await retry;
  assert.equal(closed, 1); assert.equal(calls, 2); f.h.unmount();
});

test('a rejected book-removal callback retains the dialog without claiming that data was kept', async () => {
  let closed = false;
  const f = removalEditor(async () => { throw new Error('Unknown failure'); }, () => { closed = true; });
  await labelled(f.root, 'Remove A book from Library').onPress();
  const root = f.render();
  assert.equal(closed, false);
  assert.match(elements(root).find(node => node.props?.accessibilityRole === 'alert').props.children, /could not be confirmed.*Check this book/);
  f.h.unmount();
});

test('cancel before removal dismisses confirmation and late completion cannot close a different screen', async () => {
  let dismissed = 0;
  const cancel = removalEditor(async () => assert.fail('Unexpected remove'), () => dismissed++);
  labelled(cancel.root, 'Keep this book').onPress();
  assert.equal(dismissed, 1); cancel.h.unmount();
  let resolve, closed = false;
  const f = removalEditor(() => new Promise(done => { resolve = done; }), () => { closed = true; });
  const pending = labelled(f.root, 'Remove A book from Library').onPress();
  f.h.unmount(); const writes = f.h.stateWrites(); resolve({ removed: true, message: 'Removed' }); await pending;
  assert.equal(closed, false); assert.equal(f.h.stateWrites(), writes);
});

function coverEditorHarness({ onSave = async () => ({ saved: true, message: 'Saved' }), onClose = () => {}, picker = {}, book = {} } = {}) {
  const h = harness({ runEffects: true, moduleMocks: {
    'expo-document-picker': {}, 'expo-image-picker': picker,
    '../lib/epubParser': {}, './BrowseBooksScreen': { BrowseBooksScreen: 'BrowseBooksScreen' },
    './BookCover': { BookCover: 'BookCover', CLOTH: Object.fromEntries(['parchment', 'slate', 'sage', 'terracotta'].map(tint => [tint, { bg: '#fff' }])) },
    './ui/Chip': { Chip: 'Chip' }, './ui/ProgressBar': { ProgressBar: 'ProgressBar' },
  } });
  const { CoverEditor } = h.load('../src/components/LibraryView.tsx');
  const props = { book: { id: 'book', title: 'A book', coverUrl: 'https://example.com/old.jpg', ...book }, globalStyle: 'image', onSave, onClose,
    onRemove: async () => assert.fail('Unexpected removal') };
  let root;
  const render = () => { root = h.render(CoverEditor, props); return root; };
  render(); return { h, render, root: () => root };
}

test('Apply cover waits for confirmation, saves selected cloth color, and retains the draft on failure', async () => {
  let resolve, calls = 0, closed = 0, draft;
  const f = coverEditorHarness({ onSave: value => { draft = value; calls++; return new Promise(done => { resolve = done; }); }, onClose: () => { closed++; } });
  labelled(f.root(), 'Typographic cover').onPress(); f.render();
  labelled(f.root(), 'slate cover color').onPress(); f.render();
  const pending = labelled(f.root(), 'Apply book cover').onPress();
  labelled(f.root(), 'Apply book cover').onPress(); let root = f.render();
  assert.deepEqual(draft, { style: 'typographic', tint: 'slate', image: { kind: 'keep' } }); assert.equal(calls, 1);
  assert.deepEqual(labelled(root, 'Apply book cover').accessibilityState, { disabled: true, busy: true });
  assert.equal(elements(root).some(node => node.props?.accessibilityLabel === 'Remove book'), false); assert.equal(labelled(root, 'Close book editor').disabled, true);
  root.props.onClose(); labelled(root, 'Close book editor').onPress(); assert.equal(closed, 0);
  resolve({ saved: false, message: 'Cover could not be saved. Your draft is still here.' }); await pending; root = f.render();
  assert.equal(closed, 0); assert.equal(labelled(root, 'slate cover color').accessibilityState.selected, true);
  assert.ok(elements(root).some(node => node.props?.children === 'Cover could not be saved. Your draft is still here.'));
  const retry = labelled(root, 'Apply book cover').onPress(); resolve({ saved: true, message: 'Saved on this device' }); await retry;
  assert.equal(closed, 1); f.h.unmount();
});

test('invalid cover URLs cannot be applied, and saving freezes the URL draft until acknowledgement', async () => {
  let resolve, calls = 0, draft;
  const f = coverEditorHarness({ onSave: value => { calls++; draft = value; return new Promise(done => { resolve = done; }); } });
  labelled(f.root(), 'Cover image URL').onChangeText('file:///private/photo.jpg'); f.render();
  await labelled(f.root(), 'Apply book cover').onPress(); let root = f.render();
  assert.equal(calls, 0); assert.equal(labelled(root, 'Cover image URL').value, 'file:///private/photo.jpg');
  assert.match(elements(root).find(node => node.props?.accessibilityRole === 'alert').props.children, /valid public HTTP or HTTPS/);
  labelled(root, 'Cover image URL').onChangeText(' HTTPS://example.com/new.jpg '); f.render();
  const pending = labelled(f.root(), 'Apply book cover').onPress(); root = f.render();
  assert.equal(labelled(root, 'Cover image URL').editable, false);
  labelled(root, 'Cover image URL').onChangeText('https://example.com/stale.jpg'); f.render();
  assert.deepEqual(draft.image, { kind: 'url', url: 'https://example.com/new.jpg' });
  resolve({ saved: false, message: 'Storage failed' }); await pending; root = f.render();
  assert.equal(labelled(root, 'Cover image URL').value, ' HTTPS://example.com/new.jpg '); f.h.unmount();
});

test('choosing a photo remains a draft until Apply and duplicate picker requests are blocked', async () => {
  let resolvePicker, launches = 0, saves = 0, draft, closed = 0;
  const f = coverEditorHarness({ picker: {
    requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
    launchImageLibraryAsync: () => { launches++; return new Promise(done => { resolvePicker = done; }); },
  }, onSave: async value => { saves++; draft = value; return { saved: false, message: 'Copy failed; draft retained' }; }, onClose: () => { closed++; } });
  const choosing = labelled(f.root(), 'Choose cover from photos').onPress();
  labelled(f.root(), 'Choose cover from photos').onPress(); await flushJobs(); let root = f.render();
  assert.equal(launches, 1); assert.equal(labelled(root, 'Apply book cover').disabled, true);
  root.props.onClose(); assert.equal(closed, 0);
  resolvePicker({ canceled: false, assets: [{ uri: 'file:///picker/photo.jpg' }] }); await choosing; root = f.render();
  assert.equal(saves, 0); assert.equal(labelled(root, 'Cover image URL').value, '');
  assert.equal(elements(root).find(node => node.type === 'BookCover').props.uriOverride, 'file:///picker/photo.jpg');
  await labelled(root, 'Apply book cover').onPress(); root = f.render();
  assert.equal(saves, 1); assert.deepEqual(draft.image, { kind: 'photo', uri: 'file:///picker/photo.jpg' });
  assert.equal(closed, 0); assert.equal(elements(root).find(node => node.type === 'BookCover').props.uriOverride, 'file:///picker/photo.jpg');
  root.props.onClose(); assert.equal(closed, 1); f.h.unmount();
});

test('photo permission denial, cancellation and SDK errors keep the existing draft usable', async () => {
  for (const scenario of ['denied', 'cancelled', 'error']) {
    const f = coverEditorHarness({ picker: {
      requestMediaLibraryPermissionsAsync: async () => ({ granted: scenario !== 'denied' }),
      launchImageLibraryAsync: async () => { if (scenario === 'error') throw Error('Picker unavailable'); return { canceled: true }; },
    } });
    if (scenario === 'denied') f.h.native.Platform.OS = 'ios';
    labelled(f.root(), 'Cover image URL').onChangeText('https://example.com/draft.jpg'); f.render();
    await labelled(f.root(), 'Choose cover from photos').onPress(); const root = f.render();
    assert.equal(labelled(root, 'Cover image URL').value, 'https://example.com/draft.jpg');
    assert.equal(labelled(root, 'Apply book cover').disabled, false);
    if (scenario !== 'cancelled') assert.ok(elements(root).some(node => node.props?.accessibilityRole === 'alert'));
    f.h.unmount();
  }
});

test('a late cover save or picker result cannot close/update an unmounted editor', async () => {
  let resolve, closed = false;
  const f = coverEditorHarness({ onSave: () => new Promise(done => { resolve = done; }), onClose: () => { closed = true; } });
  const pending = labelled(f.root(), 'Apply book cover').onPress(); f.h.unmount(); const writes = f.h.stateWrites();
  resolve({ saved: true, message: 'Saved' }); await pending;
  assert.equal(closed, false); assert.equal(f.h.stateWrites(), writes);
  let chosen;
  const other = coverEditorHarness({ picker: {
    requestMediaLibraryPermissionsAsync: async () => assert.fail('Android must use selected-photo access'),
    launchImageLibraryAsync: () => new Promise(done => { chosen = done; }),
  } });
  const choosing = labelled(other.root(), 'Choose cover from photos').onPress(); other.h.unmount(); const count = other.h.stateWrites();
  chosen({ canceled: false, assets: [{ uri: 'file:///picker/photo.jpg' }] }); await choosing;
  assert.equal(other.h.stateWrites(), count);
});

test('actual library covers render saved cloth colors, reject invalid legacy colors, and honor preview overrides', () => {
  const h = harness({ moduleMocks: { 'expo-linear-gradient': { LinearGradient: 'LinearGradient' } } });
  const { BookCover, CLOTH } = h.load('../src/components/BookCover.tsx');
  for (const color of ['parchment', 'slate', 'sage', 'terracotta', 'constructor']) {
    const props = { style: 'typographic', book: { title: 'Book', author: 'Author', coverUrl: '', coverAlt: 'Cover', coverTint: color } };
    const root = h.render(BookCover, props);
    const expected = CLOTH[color === 'constructor' ? 'parchment' : color].bg;
    assert.ok(elements(root).some(node => Array.isArray(node.props?.style) && node.props.style.some(style => style?.backgroundColor === expected)));
  }
  const preview = h.render(BookCover, { style: 'typographic', tint: 'sage', book: { title: 'Book', author: 'Author', coverUrl: '', coverAlt: 'Cover', coverTint: 'slate' } });
  assert.ok(elements(preview).some(node => Array.isArray(node.props?.style) && node.props.style.some(style => style?.backgroundColor === CLOTH.sage.bg)));
  h.unmount();
});

test('an unexpected cover callback error keeps the draft open without claiming a confirmed save', async () => {
  let closed = false;
  const f = coverEditorHarness({ onSave: async () => { throw Error('Unexpected failure'); }, onClose: () => { closed = true; } });
  await labelled(f.root(), 'Apply book cover').onPress(); const root = f.render();
  assert.equal(closed, false); assert.equal(labelled(root, 'Apply book cover').disabled, false);
  assert.match(elements(root).find(node => node.props?.accessibilityRole === 'alert').props.children, /could not be confirmed.*draft is still here/);
  f.h.unmount();
});

function libraryHarness(overrides = {}) {
  const selected = [], opened = [], removed = [], hapticCalls = [];
  let pickerCalls = 0, failFeedback = false;
  const h = harness({ runEffects: true, moduleMocks: {
    'expo-document-picker': { getDocumentAsync: async () => { pickerCalls++; return { canceled: true }; } },
    'expo-image-picker': {}, '../lib/epubParser': {},
    'expo-haptics': { AndroidHaptics: { Long_Press: 'long-press' }, ImpactFeedbackStyle: { Light: 'light' },
      performAndroidHapticsAsync: async value => { hapticCalls.push(value); if (failFeedback) throw Error('Haptics unavailable'); }, impactAsync: async value => { hapticCalls.push(value); } },
    './BrowseBooksScreen': { BrowseBooksScreen: 'BrowseBooksScreen' },
    './BookCover': { BookCover: 'BookCover', CLOTH: {} },
    './ui/Chip': { Chip: 'Chip' }, './ui/ProgressBar': { ProgressBar: 'ProgressBar' },
  } });
  const { LibraryView, CoverEditor } = h.load('../src/components/LibraryView.tsx');
  const book = (id, patch = {}) => ({ id, title: id, author: 'An Author', currentPage: 1, totalPages: 10, progressPercent: 0, lastOpened: 'Not yet read', coverUrl: '', minutesLeft: 20, ...patch });
  const props = { storage: {}, hasLegacyData: false,
    books: [book('Amber', { author: 'Zoë', lastOpened: '2026-01-01', progressPercent: 20 }), book('Brook', { lastOpened: '2026-11-19', progressPercent: 40 }), book('Cloud', { isDownloaded: true, lastOpened: '2026-11-20' }), book('Unread', { progressPercent: 1 })],
    availableBookIds: ['Amber', 'Brook', 'Unread'], libraryStatus: 'ready',
    recoveryBooks: [{ id: 'missing', title: 'Café', author: 'Zoë' }], selectedBookId: null,
    readingGoal: { minutesReadToday: 0, streakDays: 0, booksFinishedYear: 0 }, globalCoverStyle: 'image', bottomInset: 0,
    onSelectBook: id => selected.push(id), onOpenBook: id => opened.push(id),
    onAddEpubBook: async () => assert.fail('Unexpected import'), onRestoreImportedProgress: async book => book,
    onReimportRecoveryBook: async () => assert.fail('Unexpected recovery'),
    onUpdateBookCover: async () => ({ saved: true, message: 'Saved' }), onRemoveBook: async () => ({ removed: true, message: 'Removed' }),
    onRemoveBooks: async ids => { removed.push(ids); return { removed: true, message: 'Removed' }; }, showToast() {}, ...overrides };
  return { h, props, selected, opened, removed, hapticCalls, failFeedback: () => { failFeedback = true; }, CoverEditor, pickerCalls: () => pickerCalls, render: () => h.render(LibraryView, props) };
}
const libraryRows = root => elements(root).filter(node => node.props?.accessibilityHint === 'Open book details');
const selectionRows = root => elements(root).filter(node => node.props?.accessibilityRole === 'checkbox' && node.props.onLongPress);
const pressLibraryFilter = (root, label) => labelled(root, label).onPress();

test('holding a Library book enters selection with one native haptic, and further taps select without opening details', async () => {
  const f = libraryHarness(); let root = f.render();
  libraryRows(root).find(node => node.props.accessibilityLabel.startsWith('Amber by')).props.onLongPress(); root = f.render();
  assert.deepEqual(f.hapticCalls, ['long-press']); assert.deepEqual(f.selected, []);
  assert.equal(selectionRows(root).find(node => node.props.accessibilityLabel.startsWith('Amber by')).props.accessibilityState.checked, true);
  assert.equal(elements(root).some(node => node.type === f.CoverEditor), false);
  assert.equal(elements(root).some(node => node.props?.accessibilityLabel === 'Customize cover for Amber'), false);
  selectionRows(root).find(node => node.props.accessibilityLabel.startsWith('Brook by')).props.onPress(); root = f.render();
  assert.ok(labelled(root, 'Remove 2 selected books'));
  selectionRows(root).find(node => node.props.accessibilityLabel.startsWith('Cloud by')).props.onLongPress(); root = f.render();
  assert.ok(labelled(root, 'Remove 3 selected books')); assert.deepEqual(f.hapticCalls, ['long-press']);
  selectionRows(root).find(node => node.props.accessibilityLabel.startsWith('Amber by')).props.onPress(); root = f.render();
  assert.equal(selectionRows(root).find(node => node.props.accessibilityLabel.startsWith('Amber by')).props.accessibilityState.checked, false);
  assert.deepEqual(f.selected, []); assert.deepEqual(f.removed, []);
  labelled(root, 'Exit book selection').onPress(); root = f.render();
  assert.equal(libraryRows(root).length, 4);
  libraryRows(root)[0].props.onPress(); assert.equal(f.selected.length, 1); f.h.unmount();
});

test('selection survives sorting, two/three columns, list view and search; hidden selections are explicitly counted', async () => {
  const f = libraryHarness(); let root = f.render();
  libraryRows(root).find(node => node.props.accessibilityLabel.startsWith('Amber by')).props.onLongPress(); root = f.render();
  labelled(root, '3-column grid').onPress(); labelled(root, 'Sort Library by Title').onPress(); root = f.render();
  assert.equal(selectionRows(root)[0].props.accessibilityState.checked, true);
  labelled(root, 'List view').onPress(); root = f.render();
  assert.equal(selectionRows(root)[0].props.accessibilityState.checked, true);
  f.props.searchRequest = 1; f.render(); root = f.render();
  labelled(root, 'Search Library by title or author').onChangeText('brook'); root = f.render();
  assert.equal(selectionRows(root).length, 1); assert.ok(labelled(root, 'Remove 1 selected book'));
  assert.match(elements(root).flatMap(node => node.props?.children).filter(value => typeof value === 'string' || typeof value === 'number').join('').replace(/\s+/g, ' '), /1 selected book is outside this view/);
  labelled(root, 'Select all shown books').onPress(); root = f.render();
  assert.ok(labelled(root, 'Remove 2 selected books'));
  labelled(root, 'Deselect all shown books').onPress(); root = f.render();
  assert.ok(labelled(root, 'Remove 1 selected book'));
  assert.equal(f.h.hardwareBack(), true); root = f.render();
  assert.equal(selectionRows(root).length, 0); assert.equal(f.h.hardwareBack(), false); f.h.unmount();
});

test('Select shown excludes recovery placeholders and zero selected books cannot open removal', () => {
  const f = libraryHarness(); let root = f.render(); libraryRows(root)[0].props.onLongPress(); root = f.render();
  labelled(root, 'Select all shown books').onPress(); root = f.render();
  assert.ok(labelled(root, 'Remove 4 selected books'));
  assert.equal(labelled(root, 'Re-import Café from a local EPUB').disabled, true);
  labelled(root, 'Deselect all shown books').onPress(); root = f.render();
  const remove = labelled(root, 'Remove 0 selected books'); assert.equal(remove.disabled, true); remove.onPress(); root = f.render();
  assert.equal(elements(root).some(node => node.props?.titles), false);
  assert.deepEqual(f.removed, []); f.h.unmount();
});

test('bulk confirmation is cancellable, names only the selection, and submits one batch rather than separate removals', async () => {
  const f = libraryHarness(); let root = f.render();
  libraryRows(root).find(node => node.props.accessibilityLabel.startsWith('Amber by')).props.onLongPress(); root = f.render();
  selectionRows(root).find(node => node.props.accessibilityLabel.startsWith('Brook by')).props.onPress(); root = f.render();
  labelled(root, 'Remove 2 selected books').onPress(); root = f.render();
  let dialog = elements(root).find(node => node.props?.titles);
  assert.deepEqual(new Set(dialog.props.titles), new Set(['Amber', 'Brook']));
  dialog.props.onClose(); root = f.render(); assert.deepEqual(f.removed, []);
  assert.ok(labelled(root, 'Remove 2 selected books'));
  labelled(root, 'Remove 2 selected books').onPress(); root = f.render();
  dialog = elements(root).find(node => node.props?.titles);
  assert.equal((await dialog.props.onRemove()).removed, true); root = f.render();
  assert.deepEqual(f.removed, [['Amber', 'Brook']]); assert.equal(selectionRows(root).length, 0); f.h.unmount();
});

test('failed bulk removals retain selection and late results cannot update an unmounted Library', async () => {
  let complete;
  const f = libraryHarness({ onRemoveBooks: () => new Promise(resolve => { complete = resolve; }) });
  let root = f.render(); libraryRows(root)[0].props.onLongPress(); root = f.render();
  labelled(root, 'Remove 1 selected book').onPress(); root = f.render();
  let dialog = elements(root).find(node => node.props?.titles);
  const pending = dialog.props.onRemove(); complete({ removed: false, message: 'Library could not be saved.' });
  assert.equal((await pending).removed, false); root = f.render();
  assert.ok(labelled(root, 'Remove 1 selected book')); dialog = elements(root).find(node => node.props?.titles); assert.ok(dialog);
  const later = dialog.props.onRemove(); f.h.unmount(); const writes = f.h.stateWrites();
  complete({ removed: true, message: 'Removed' }); await later; assert.equal(f.h.stateWrites(), writes);
});

test('unavailable haptics do not prevent selection, and accessibility actions can enter selection without holding', async () => {
  const f = libraryHarness(); f.failFeedback(); let root = f.render();
  libraryRows(root).find(node => node.props.accessibilityLabel.startsWith('Amber by')).props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } }); await flushNative(); root = f.render();
  assert.ok(labelled(root, 'Remove 1 selected book')); assert.deepEqual(f.selected, []);
  f.props.books = f.props.books.slice(1); f.render(); root = f.render();
  assert.ok(labelled(root, 'Remove 0 selected books')); f.h.unmount();
  for (const libraryStatus of ['loading', 'error']) {
    const blocked = libraryHarness({ libraryStatus }); let tree = blocked.render(); libraryRows(tree)[0].props.onLongPress(); tree = blocked.render();
    assert.equal(selectionRows(tree).length, 0); assert.equal(blocked.hapticCalls.length, 0); blocked.h.unmount();
  }
});

test('bulk confirmation blocks duplicate deletion and dismissal until acknowledged, and displays all selected titles', async () => {
  let complete, calls = 0, closed = 0;
  const h = harness({ runEffects: true }), { BookRemovalDialog } = h.load('../src/components/BookRemovalDialog.tsx');
  const props = { titles: ['Amber', 'Brook'], onClose: () => { closed++; }, onRemove: () => { calls++; return new Promise(resolve => { complete = resolve; }); } };
  let root = h.render(BookRemovalDialog, props);
  const content = elements(root).flatMap(node => node.props?.children).filter(value => typeof value === 'string').join(' ');
  assert.match(content, /Remove 2 books/); assert.match(content, /Amber/); assert.match(content, /Brook/);
  const pending = labelled(root, 'Remove 2 books from Library').onPress(); labelled(root, 'Remove 2 books from Library').onPress(); root = h.render(BookRemovalDialog, props);
  labelled(root, 'Keep these books').onPress(); root.props.onClose(); assert.equal(closed, 0); assert.equal(calls, 1);
  assert.equal(labelled(root, 'Remove 2 books from Library').disabled, true);
  complete({ removed: false, message: 'Recovery needed. Saved intent retained.' }); await pending; root = h.render(BookRemovalDialog, props);
  assert.match(elements(root).find(node => node.props?.accessibilityRole === 'alert').props.children, /Recovery needed/); assert.equal(closed, 0);
  labelled(root, 'Keep these books').onPress(); assert.equal(closed, 1); h.unmount();
});

test('Library search filters title/author and recovery rows; clearing results resets query and filter while keeping sort', () => {
  const f = libraryHarness(); let root = f.render();
  f.props.searchRequest = 1; f.render(); root = f.render();
  labelled(root, 'Search Library by title or author').onChangeText('zoe'); root = f.render();
  assert.equal(libraryRows(root).length, 1); assert.match(libraryRows(root)[0].props.accessibilityLabel, /^Amber by Zoë/);
  assert.ok(labelled(root, 'Re-import Café from a local EPUB'));
  assert.equal(elements(root).some(node => node.props?.accessibilityLabel?.startsWith('Resume ')), false);
  labelled(root, 'Sort Library by Title').onPress();
  pressLibraryFilter(f.render(), 'Finished'); root = f.render();
  assert.equal(libraryRows(root).length, 0);
  labelled(root, 'Clear Library search and filters').onPress(); root = f.render();
  assert.equal(labelled(root, 'Search Library by title or author').value, '');
  assert.equal(labelled(root, 'Sort Library by Title').accessibilityState.selected, true);
  assert.equal(labelled(root, 'All Books').accessibilityState.selected, true);
  assert.deepEqual(libraryRows(root).map(node => node.props.accessibilityLabel.split(' by ')[0]), ['Amber', 'Brook', 'Cloud', 'Unread']);
  labelled(root, 'Search Library by title or author').onChangeText('brook'); root = f.render();
  labelled(root, 'Clear Library search').onPress(); root = f.render();
  assert.equal(libraryRows(root).length, 4); f.h.unmount();
});

test('Library Recent and Continue Reading use reading date and device text; Downloaded rejects a cloud flag', () => {
  const f = libraryHarness(); let root = f.render();
  assert.deepEqual(libraryRows(root).map(node => node.props.accessibilityLabel.split(' by ')[0]), ['Cloud', 'Brook', 'Amber', 'Unread']);
  labelled(root, 'Resume Brook by An Author').onPress(); assert.deepEqual(f.opened, ['Brook']);
  pressLibraryFilter(root, 'Downloaded'); root = f.render();
  assert.deepEqual(libraryRows(root).map(node => node.props.accessibilityLabel.split(' by ')[0]), ['Brook', 'Amber', 'Unread']);
  assert.equal(elements(root).some(node => node.props?.accessibilityLabel?.startsWith('Resume ')), false);
  labelled(root, 'List view').onPress(); root = f.render();
  assert.deepEqual(labelled(root, 'List view').accessibilityState, { selected: true });
  assert.deepEqual(labelled(root, '2-column grid').accessibilityState, { selected: false }); f.h.unmount();
});

test('Library header search requests show a fixed input, reset stale filters, and preserve input through grid changes', () => {
  let handled = 0;
  const f = libraryHarness({ onSearchRequestHandled: () => handled++ }); let root = f.render();
  labelled(root, 'Finished').onPress(); f.render();
  f.props.searchRequest = 1; f.render(); root = f.render();
  assert.equal(handled, 1); f.props.searchRequest = 0; root = f.render();
  assert.equal(labelled(root, 'All Books').accessibilityState.selected, true);
  labelled(root, 'Search Library by title or author').onChangeText('An Author'); root = f.render();
  assert.equal(libraryRows(root).length, 3);
  const list = elements(root).find(node => node.props?.testID === 'library-collection');
  assert.equal(elements(list.props.ListHeaderComponent).some(node => node.type === 'TextInput'), false);
  labelled(root, '3-column grid').onPress(); root = f.render();
  assert.equal(labelled(root, 'Search Library by title or author').value, 'An Author');
  assert.equal(elements(root).find(node => node.props?.testID === 'library-collection').props.data[0].length, 3);
  labelled(root, 'Hide Library search').onPress(); root = f.render();
  assert.equal(libraryRows(root).length, 4); assert.equal(elements(root).some(node => node.type === 'TextInput'), false); f.h.unmount();
});

test('Library restores and saves three columns and passes the same choice to free books', async () => {
  const writes = [], storage = { loadJSON: async () => ({ gridColumns: 3 }), saveJSONStrict: async (_key, value) => writes.push(value) };
  const f = libraryHarness({ storage }); f.render(); await flushNative(); let root = f.render();
  assert.equal(labelled(root, '3-column grid').accessibilityState.selected, true);
  assert.equal(elements(root).find(node => node.props?.testID === 'library-collection').props.data[0].length, 3);
  labelled(root, 'Browse books').onPress(); root = f.render();
  const browse = elements(root).find(node => node.type === 'BrowseBooksScreen').props;
  assert.equal(browse.gridColumns, 3); browse.onGridColumnsChange(2); browse.onClose(); root = f.render();
  assert.equal(labelled(root, '2-column grid').accessibilityState.selected, true);
  assert.equal(writes.at(-1).gridColumns, 2); f.h.unmount();
});

test('Library grid shows truthful percentage badges for unread and finished books while list status stays descriptive', () => {
  const f = libraryHarness();
  f.props.books = f.props.books.map(book => book.id === 'Amber' ? { ...book, isFinished: true } : book);
  const cover = (root, id) => elements(libraryRows(root).find(row => row.props.accessibilityLabel.startsWith(id + ' by '))).find(node => node.type === 'BookCover').props;
  let root = f.render();
  assert.deepEqual(cover(root, 'Unread').badge, { kind: 'percent', value: 0 });
  assert.deepEqual(cover(root, 'Amber').badge, { kind: 'percent', value: 100 });
  assert.deepEqual(cover(root, 'Brook').badge, { kind: 'percent', value: 40 });
  labelled(root, 'List view').onPress(); root = f.render();
  assert.equal(cover(root, 'Unread').badge, undefined);
  assert.deepEqual(cover(root, 'Amber').badge, { kind: 'read' });
  f.h.unmount();
});

test('book details and Android back retain Library search; cover edit is a separate named action', () => {
  const f = libraryHarness(); let root = f.render();
  f.props.searchRequest = 1; f.render(); root = f.render();
  labelled(root, 'Search Library by title or author').onChangeText('amber'); root = f.render();
  const row = libraryRows(root)[0]; assert.equal(row.props.accessibilityRole, 'button');
  assert.equal(elements(row).some(node => node.type === 'BookCover' && node.props.onEdit), false);
  row.props.onPress(); assert.deepEqual(f.selected, ['Amber']);
  f.props.selectedBookId = 'Amber'; root = f.render();
  assert.ok(labelled(root, 'Read Amber')); assert.equal(f.h.hardwareBack(), true); assert.deepEqual(f.selected, ['Amber', null]);
  f.props.selectedBookId = null; root = f.render();
  assert.equal(labelled(root, 'Search Library by title or author').value, 'amber');
  assert.equal(f.h.hardwareBack(), false);
  labelled(root, 'Customize cover for Amber').onPress(); root = f.render();
  assert.ok(elements(root).some(node => node.type === f.CoverEditor && node.props.book.id === 'Amber'));
  assert.deepEqual(f.selected, ['Amber', null]); f.h.unmount();
});

test('details prevent opening a cloud-only book with missing device text', () => {
  const f = libraryHarness({ selectedBookId: 'Cloud' }); const root = f.render();
  const read = labelled(root, 'Reading text unavailable');
  assert.equal(read.disabled, true); assert.deepEqual(read.accessibilityState, { disabled: true });
  read.onPress(); assert.deepEqual(f.opened, []); assert.deepEqual(f.selected, []); f.h.unmount();
});

test('Library loading and read errors do not claim an empty library or permit import', async () => {
  for (const libraryStatus of ['loading', 'error']) {
    const f = libraryHarness({ books: [], recoveryBooks: [], libraryStatus }); const root = f.render();
    const text = elements(root).flatMap(node => typeof node.props?.children === 'string' ? [node.props.children] : []).join(' ');
    assert.doesNotMatch(text, /Your library is empty|No books to show yet/);
    assert.match(text, libraryStatus === 'loading' ? /Loading your saved library/ : /Existing data has been kept/);
    const action = labelled(root, 'Import EPUB'); assert.equal(action.disabled, true);
    await action.onPress(); assert.equal(f.pickerCalls(), 0);
    assert.equal(elements(root).some(node => node.props?.accessibilityLabel?.startsWith('Resume ')), false); f.h.unmount();
  }
});

test('Library and Notebook filter chips expose a named button and its selected state', () => {
  const h = harness(); const { Chip } = h.load('../src/components/ui/Chip.tsx'); let presses = 0;
  for (const active of [false, true]) {
    const root = h.render(Chip, { label: 'Reading', active, onPress: () => presses++ });
    const control = labelled(root, 'Reading'); assert.equal(control.accessibilityRole, 'button');
    assert.deepEqual(control.accessibilityState, { selected: active }); control.onPress();
  }
  assert.equal(presses, 2);
});

function catalogHarness({ search, download, parse, save, remember, details, added = {}, item: itemPatch = {} } = {}) {
  const calls = { searches: [], downloads: [], details: [], opened: [], saved: [], deleted: [], closed: 0, toasts: [] };
  const h = harness({ runEffects: true, moduleMocks: {
    '../lib/googleBooksKeyNative': { googleBooksKeyStore: () => ({ load: async () => null, save: async key => key, remove: async () => {} }) },
    '../lib/catalogRequest': { CatalogError: require('./loadTypeScript.cjs').loadTypeScript('./src/lib/catalogRequest.ts').CatalogError },
    '../lib/catalog': {
      CATALOG_SOURCES: [{ id: 'gutenberg', label: 'Project Gutenberg' }, { id: 'standard', label: 'Standard Ebooks' }, { id: 'archive', label: 'Internet Archive' }, { id: 'google', label: 'Google Books' }],
      TOPICS: [{ id: 'popular', label: 'Popular', topic: '' }, { id: 'fiction', label: 'Fiction', topic: 'fiction' }],
      searchDiscovery: (opts, signal) => { calls.searches.push({ opts, signal }); return search ? search(opts, signal) : Promise.resolve({ books: [item], total: 1, hasMore: false }); },
      loadDiscoveryDetails: (book, signal) => { calls.details.push({ book, signal }); return details ? details(book, signal) : Promise.resolve({ ...book, description: '<p>A classic.</p>', languages: ['en'] }); },
      downloadEpub: async (...args) => { calls.downloads.push(args); return download ? download(...args) : 'file:///cache/book.epub'; },
      deleteDownloaded: uri => calls.deleted.push(uri), loadAdded: async () => added,
      rememberAdded: remember ?? (async current => current),
    },
    '../lib/epubParser': { parseEpubFile: parse ?? (async () => ({ book: { id: 'epub-new', title: 'A Book', coverUrl: 'file:///embedded/cover.jpg' }, pages: [{ pageNumber: 1 }] })) },
    './BookCover': { BookCover: 'BookCover' }, './ui/Chip': { Chip: 'Chip' }, './ui/ProgressBar': { ProgressBar: 'ProgressBar' },
  } });
  const item = { id: 'gutenberg-1', title: 'A Book', author: 'An Author', source: 'gutenberg', coverUrl: 'https://www.gutenberg.org/cover.jpg', downloads: 10, subjects: [], ...itemPatch };
  const { BrowseBooksScreen, BookRow } = h.load('../src/components/BrowseBooksScreen.tsx');
  const props = { storage: { storageKey: key => `test:${key}`, removeBookFiles: id => calls.deleted.push(id) }, books: [], availableBookIds: [], viewMode: 'grid', gridColumns: 2,
    onViewModeChange: mode => { props.viewMode = mode; }, onGridColumnsChange: count => { props.gridColumns = count; },
    onAddEpubBook: async (book, pages) => { calls.saved.push({ book, pages }); if (save) await save(book, pages); props.books = [...props.books, book]; props.availableBookIds = [...props.availableBookIds, book.id]; },
    onOpenBook: id => calls.opened.push(id), onClose: () => calls.closed++, showToast: message => calls.toasts.push(message) };
  return { h, calls, props, item, BookRow, render: () => h.render(BrowseBooksScreen, props) };
}
const freeBookList = root => elements(root).find(node => node.type === 'FlatList').props;
const freeBookRow = (f, root) => freeBookList(root).renderItem({ item: f.item }).props;
const flushNative = () => new Promise(resolve => setImmediate(resolve));
function fireNativeTimer(h, ms) {
  const entry = [...h.timers].find(([, timer]) => timer.ms === ms); assert.ok(entry, `Missing ${ms} ms timer`);
  h.timers.delete(entry[0]); entry[1].fn();
}

test('Book descriptions render native paragraphs and emphasis rather than source HTML', () => {
  const h = harness(); const { BookDescription } = h.load('../src/components/BookDescription.tsx');
  const root = h.render(BookDescription, { value: '<p>Mary wrote <i>Frankenstein</i>.</p><p>Another paragraph.</p>' });
  const paragraphs = elements(root).filter(node => node.type === 'Text' && node.props.selectable);
  assert.equal(paragraphs.length, 2);
  assert.doesNotMatch(renderedText(root), /<p>|<i>/);
  assert.ok(elements(root).some(node => node.props?.children === 'Frankenstein' && node.props.style.some(style => style?.fontStyle === 'italic')));
});

test('already-imported Library descriptions use the formatter without rewriting the stored book', () => {
  const f = libraryHarness({ selectedBookId: 'Amber' });
  f.props.books[0].annotation = '<p>An existing <i>description</i>.</p>';
  const root = f.render();
  const description = elements(root).find(node => node.type?.name === 'BookDescription');
  assert.equal(description.props.value, f.props.books[0].annotation);
  assert.equal(f.props.books[0].annotation, '<p>An existing <i>description</i>.</p>');
  f.h.unmount();
});

test('free-book covers and titles open details without downloading; Back retains catalog search and sort', async () => {
  const f = catalogHarness(); f.render(); await flushNative(); let root = f.render();
  labelled(root, 'Sort books').onPress(); root = f.render();
  labelled(root, 'Sort books by Title').onPress();
  root = f.render();
  labelled(root, 'Search books by title or author').onChangeText('A Book');
  root = f.render(); fireNativeTimer(f.h, 450); f.render(); await flushNative(); root = f.render();
  const rowProps = freeBookRow(f, root), rowHarness = harness();
  const row = rowHarness.render(f.BookRow.type, rowProps);
  labelled(row, 'View details for A Book by An Author').onPress();
  assert.equal(f.calls.downloads.length, 0);
  root = f.render(); await flushNative(); root = f.render();
  assert.equal(f.calls.details.length, 1); assert.ok(labelled(root, 'Add A Book to library'));
  assert.match(renderedText(root), /About this book/);
  const catalogList = freeBookList(root);
  labelled(root, 'Back to books').onPress(); root = f.render();
  assert.equal(f.calls.closed, 0); assert.equal(freeBookList(root).data, catalogList.data);
  assert.equal(f.calls.searches.length, 2); assert.ok(labelled(root, 'Back to library'));
  assert.equal(labelled(root, 'Search books by title or author').value, 'A Book');
  assert.equal(labelled(root, 'Sort books').accessibilityValue.text, 'Title');
  f.h.unmount(); rowHarness.unmount();
});

test('free books share two/three columns and keep search outside the results list when density changes', async () => {
  const f = catalogHarness(); f.render(); await flushNative(); let root = f.render();
  assert.equal(freeBookList(root).numColumns, 2);
  labelled(root, 'Search books by title or author').onChangeText('A Book'); root = f.render();
  labelled(root, '3-column grid').onPress(); root = f.render();
  assert.equal(freeBookList(root).numColumns, 3); assert.equal(freeBookRow(f, root).dense, true);
  assert.equal(labelled(root, 'Search books by title or author').value, 'A Book');
  assert.equal(elements(freeBookList(root).ListHeaderComponent).some(node => node.type === 'TextInput'), false);
  assert.ok(freeBookRow(f, root).cardWidth < 120);
  labelled(root, 'List view').onPress(); root = f.render(); assert.equal(freeBookList(root).numColumns, 1);
  labelled(root, '2-column grid').onPress(); root = f.render(); assert.equal(freeBookList(root).numColumns, 2); f.h.unmount();
});

test('details requests are cancelled on Back; failures offer retry while keeping download available', async () => {
  let late;
  const f = catalogHarness({ details: () => new Promise(done => { late = done; }) });
  f.render(); await flushNative(); let root = f.render(); freeBookRow(f, root).onDetails(f.item); root = f.render();
  labelled(root, 'Back to books').onPress(); f.render();
  assert.equal(f.calls.details[0].signal.aborted, true);
  const writes = f.h.stateWrites(); late({ ...f.item, description: 'Late description' }); await flushNative();
  assert.equal(f.h.stateWrites(), writes); f.h.unmount();
  let attempts = 0;
  const retry = catalogHarness({ details: async book => { if (++attempts === 1) throw Error('Offline'); return { ...book, description: 'Recovered' }; } });
  retry.render(); await flushNative(); root = retry.render(); freeBookRow(retry, root).onDetails(retry.item);
  retry.render(); await flushNative(); root = retry.render();
  assert.ok(labelled(root, 'Add A Book to library'));
  labelled(root, 'Retry book details').onPress(); retry.render(); await flushNative(); root = retry.render();
  assert.equal(retry.calls.details.length, 2);
  assert.equal(elements(root).some(node => node.props?.accessibilityLabel === 'Retry book details'), false); retry.h.unmount();
});

test('downloading from free-book details keeps confirmed save, retry and Read behavior', async () => {
  const f = catalogHarness(); f.render(); await flushNative(); let root = f.render();
  freeBookRow(f, root).onDetails(f.item); f.render(); await flushNative(); root = f.render();
  labelled(root, 'Add A Book to library').onPress(); await flushNative(); fireNativeTimer(f.h, 60); await flushNative(); root = f.render();
  assert.equal(f.calls.saved.length, 1); assert.equal(f.calls.saved[0].book.annotation, '<p>A classic.</p>');
  labelled(root, 'Read A Book').onPress(); assert.equal(f.calls.closed, 1); assert.deepEqual(f.calls.opened, ['epub-new']);
  f.h.unmount();
});

test('free-book source changes cancel old results; provider errors keep retry and other sources available', async () => {
  let first;
  const f = catalogHarness({ search: opts => opts.source === 'all' ? new Promise(done => { first = done; }) : Promise.reject(Error('Source unavailable')) });
  let root = f.render();
  labelled(root, 'Standard Ebooks').onPress(); root = f.render();
  assert.equal(f.calls.searches[0].signal.aborted, true);
  first({ books: [f.item], total: 1, hasMore: false }); await flushNative(); root = f.render();
  assert.equal(freeBookList(root).data.length, 0);
  assert.ok(labelled(freeBookList(root).ListEmptyComponent, 'Retry catalog'));
  labelled(freeBookList(root).ListEmptyComponent, 'Retry catalog').onPress(); f.render(); await flushNative();
  assert.equal(f.calls.searches.length, 3); assert.equal(f.calls.searches[2].opts.source, 'standard'); f.h.unmount();
});

test('free-book failures remain on their row and retry saves artwork only after confirmed import', async () => {
  let attempts = 0, release;
  const f = catalogHarness({ download: async () => { if (++attempts === 1) throw Error('Connection interrupted'); return 'file:///cache/book.epub'; }, save: () => new Promise(done => { release = done; }) });
  f.render(); await flushNative(); let root = f.render();
  freeBookRow(f, root).onGet(f.item); freeBookRow(f, root).onGet(f.item); await flushNative(); root = f.render();
  assert.equal(f.calls.downloads.length, 1); assert.equal(freeBookRow(f, root).error, 'Connection interrupted'); assert.equal(freeBookRow(f, root).status, 'get');
  freeBookRow(f, root).onGet(f.item); await flushNative(); fireNativeTimer(f.h, 60); await flushNative(); root = f.render();
  assert.equal(freeBookRow(f, root).status, 'preparing'); assert.equal(f.calls.saved.length, 1);
  assert.equal(f.calls.saved[0].book.coverUrl, 'file:///embedded/cover.jpg'); assert.equal(f.calls.saved[0].book.coverStyle, 'image');
  labelled(root, 'Back to library').onPress(); root.props.onRequestClose(); assert.equal(f.calls.closed, 0);
  release(); await flushNative(); root = f.render(); assert.equal(freeBookRow(f, root).status, 'added');
  assert.equal(freeBookRow(f, root).error, undefined); assert.deepEqual(f.calls.deleted, ['file:///cache/book.epub']); f.h.unmount();
});

test('closing or cancelling a download prevents a late transfer from importing', async () => {
  for (const close of [true, false]) {
    let finish;
    const f = catalogHarness({ download: () => new Promise(done => { finish = done; }) });
    f.render(); await flushNative(); let root = f.render(); freeBookRow(f, root).onGet(f.item); root = f.render();
    labelled(root, close ? 'Back to library' : 'Cancel book download').onPress(); assert.equal(f.calls.downloads[0][2].aborted, true);
    if (close) f.h.unmount();
    const writes = f.h.stateWrites(); finish('file:///cache/book.epub'); await flushNative();
    assert.equal(f.calls.saved.length, 0); assert.deepEqual(f.calls.deleted, ['file:///cache/book.epub']);
    if (close) assert.equal(f.h.stateWrites(), writes); else f.h.unmount();
  }
});

test('a failed catalog shortcut save does not label a confirmed library import as a failed download', async () => {
  const f = catalogHarness({ remember: async () => { throw Error('storage full'); } });
  f.render(); await flushNative(); let root = f.render(); freeBookRow(f, root).onGet(f.item);
  await flushNative(); fireNativeTimer(f.h, 60); await flushNative(); root = f.render();
  assert.equal(freeBookRow(f, root).status, 'added'); assert.equal(freeBookRow(f, root).error, undefined);
  assert.match(f.calls.toasts[0], /Book saved in Library/); f.h.unmount();
});

test('free-book rows expose a named retry with persistent error and truthful busy state', () => {
  const f = catalogHarness();
  const props = { item: f.item, status: 'get', error: 'Source unavailable', disabled: false, onGet: () => f.calls.downloads.push('retry'), viewMode: 'list', cardWidth: 160 };
  let root = f.h.render(f.BookRow.type, props);
  const retry = labelled(root, 'Retry downloading A Book'); assert.equal(retry.accessibilityRole, 'button'); retry.onPress(); assert.equal(f.calls.downloads.length, 1);
  assert.ok(elements(root).some(node => node.props?.accessibilityRole === 'alert' && node.props.children === 'Source unavailable'));
  root = f.h.render(f.BookRow.type, { ...props, error: undefined, status: 'downloading' });
  assert.deepEqual(labelled(root, 'Downloading A Book').accessibilityState, { busy: true });
  assert.equal(labelled(root, 'Downloading A Book').accessibilityRole, 'progressbar');
});

test('image covers show bundled illustrations when missing or failed; explicit cloth styling remains available', () => {
  const h = harness({ runEffects: true, moduleMocks: { 'expo-linear-gradient': { LinearGradient: 'LinearGradient' } } });
  const { BookCover } = h.load('../src/components/BookCover.tsx');
  const book = { title: 'A Book', author: 'An Author', coverUrl: '', coverAlt: 'A book cover' };
  let root = h.render(BookCover, { book, style: 'image' });
  assert.ok(elements(root).some(node => node.type === 'CoverIllustration'));
  root = h.render(BookCover, { book: { ...book, coverUrl: 'https://example.com/cover.jpg' }, style: 'image', variant: 'library' });
  elements(root).find(node => node.type === 'Image').props.onError(); root = h.render(BookCover, { book: { ...book, coverUrl: 'https://example.com/cover.jpg' }, style: 'image', variant: 'library' });
  assert.ok(elements(root).some(node => node.type === 'CoverIllustration'));
  root = h.render(BookCover, { book, style: 'typographic' });
  assert.equal(elements(root).some(node => node.type === 'CoverIllustration'), false); h.unmount();
});

test('duplicate-download confirmation prevents repeated taps from starting concurrent imports', async () => {
  const f = catalogHarness({ download: () => new Promise(() => {}) });
  f.props.books = [{ id: 'existing', title: 'A Book' }];
  f.render(); await flushNative(); let root = f.render();
  freeBookRow(f, root).onGet(f.item); root = f.render(); assert.equal(f.calls.downloads.length, 0);
  const confirm = labelled(root, 'Download another copy'); confirm.onPress(); confirm.onPress();
  assert.equal(f.calls.downloads.length, 1); f.h.unmount();
});

function renderedText(root) {
  if (typeof root === 'string' || typeof root === 'number') return String(root);
  if (Array.isArray(root)) return root.map(renderedText).join(' ');
  return renderedText(root?.props?.children ?? '');
}
const selectNotebookFilter = (root, label) => elements(root).find(node => node.type === 'Chip' && node.props.label === label).props.onPress();

test('Notebook counts vocabulary-only results without displaying an empty highlight archive', () => {
  const f = notebookHarness({ lexicon: [vocabularyCard('word')] });
  const root = f.h.render(f.NotebookView, f.props), text = renderedText(root);
  assert.match(text, /0 highlights · 1 vocabulary card/); assert.match(text, /Quietude/);
  assert.doesNotMatch(text, /No highlights|Notebook is empty/); f.h.unmount();
});

test('Notebook normalized search finds quotes and vocabulary context; misses offer reset rather than an empty archive claim', () => {
  const f = notebookHarness({ highlights: [savedHighlight('one', { text: 'A café [garden]', chapter: 'Arrival' })], lexicon: [vocabularyCard('word')] });
  let root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Search Notebook').onChangeText(' CAFE  ARRIVAL '); root = f.h.render(f.NotebookView, f.props);
  assert.match(renderedText(root), /1 highlight · 0 vocabulary cards/);
  labelled(root, 'Search Notebook').onChangeText('garden arrival quietude'); root = f.h.render(f.NotebookView, f.props);
  assert.match(renderedText(root), /0 highlights · 1 vocabulary card/);
  labelled(root, 'Search Notebook').onChangeText('absent'); root = f.h.render(f.NotebookView, f.props);
  assert.match(renderedText(root), /No matching entries/); assert.doesNotMatch(renderedText(root), /Notebook is empty/);
  labelled(root, 'Show all Notebook entries').onPress(); root = f.h.render(f.NotebookView, f.props);
  assert.equal(labelled(root, 'Search Notebook').value, ''); assert.match(renderedText(root), /1 highlight · 1 vocabulary card/); f.h.unmount();
});

test('Notebook book picker announces expansion and selection; clear search keeps scope while Show all resets it', () => {
  const f = notebookHarness({ books: [{ id: 'book', title: 'A book' }, { id: 'other', title: 'Another book' }], highlights: [savedHighlight('one', { note: 'A reflection' })] });
  let root = f.h.render(f.NotebookView, f.props);
  const picker = labelled(root, 'Filter Notebook by book: All Books'); assert.equal(picker.accessibilityRole, 'button'); assert.equal(picker.accessibilityState.expanded, false);
  picker.onPress(); root = f.h.render(f.NotebookView, f.props); assert.equal(labelled(root, 'Filter Notebook by book: All Books').accessibilityState.expanded, true);
  labelled(root, 'Show Notebook entries for A book').onPress(); root = f.h.render(f.NotebookView, f.props);
  selectNotebookFilter(root, 'Notes'); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Search Notebook').onChangeText('missing'); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Clear Notebook search').onPress(); root = f.h.render(f.NotebookView, f.props);
  assert.ok(labelled(root, 'Filter Notebook by book: A book')); assert.equal(elements(root).find(node => node.type === 'Chip' && node.props.label === 'Notes').props.active, true);
  labelled(root, 'Filter Notebook by book: A book').onPress(); root = f.h.render(f.NotebookView, f.props);
  assert.equal(labelled(root, 'Show Notebook entries for A book').accessibilityState.selected, true);
  labelled(root, 'Show Notebook entries for Another book').onPress(); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Show all Notebook entries').onPress(); root = f.h.render(f.NotebookView, f.props);
  assert.ok(labelled(root, 'Filter Notebook by book: All Books')); assert.equal(elements(root).find(node => node.type === 'Chip' && node.props.label === 'All Entries').props.active, true); f.h.unmount();
});

test('Notebook empty messages reflect the chosen entry type and never mask relevant loading/errors', () => {
  const f = notebookHarness(); let root = f.h.render(f.NotebookView, f.props);
  assert.match(renderedText(root), /Your Notebook is empty/);
  selectNotebookFilter(root, 'Notes'); root = f.h.render(f.NotebookView, f.props); assert.match(renderedText(root), /No reflection notes yet/);
  selectNotebookFilter(root, 'Lexicon Cards'); root = f.h.render(f.NotebookView, f.props); assert.match(renderedText(root), /No vocabulary cards yet/);
  f.props.vocabularyStatus = 'loading'; root = f.h.render(f.NotebookView, f.props); assert.doesNotMatch(renderedText(root), /No vocabulary cards yet/); assert.match(renderedText(root), /Loading saved entries/);
  f.props.vocabularyStatus = 'error'; root = f.h.render(f.NotebookView, f.props); assert.doesNotMatch(renderedText(root), /No vocabulary cards yet/); assert.match(renderedText(root), /Some saved entries unavailable/);
  f.props.vocabularyStatus = 'ready'; f.props.highlightStatus = 'error'; root = f.h.render(f.NotebookView, f.props); assert.match(renderedText(root), /No vocabulary cards yet/); f.h.unmount();
});

test('Notebook does not silently create a quote under another book when the selected book disappears', () => {
  const f = notebookHarness({ books: [{ id: 'book', title: 'A book' }, { id: 'other', title: 'Another book' }] });
  let root = f.h.render(f.NotebookView, f.props); labelled(root, 'Filter Notebook by book: All Books').onPress(); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Show Notebook entries for A book').onPress(); root = f.h.render(f.NotebookView, f.props);
  f.props.books = [{ id: 'other', title: 'Another book' }]; root = f.h.render(f.NotebookView, f.props);
  assert.ok(labelled(root, 'Filter Notebook by book: Selected book unavailable')); assert.match(renderedText(root), /Selected book unavailable/);
  assert.equal(labelled(root, 'New quote').disabled, true); labelled(root, 'New quote').onPress(); root = f.h.render(f.NotebookView, f.props);
  assert.equal(elements(root).some(node => node.props?.accessibilityLabel === 'Quote text'), false); f.h.unmount();
});

test('Notebook filtering preserves a reflection draft and export counts include scoped vocabulary', () => {
  const f = notebookHarness({ highlights: [savedHighlight('one')], lexicon: [vocabularyCard('word')] });
  let root = f.h.render(f.NotebookView, f.props); labelled(root, 'Add reflection note').onPress(); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Reflection note').onChangeText('Unsaved reflection'); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Search Notebook').onChangeText('missing'); root = f.h.render(f.NotebookView, f.props);
  assert.match(renderedText(root), /Export \( 2 \)/); assert.match(renderedText(root), /Search and entry filters do not limit the export/);
  labelled(root, 'Show all Notebook entries').onPress(); root = f.h.render(f.NotebookView, f.props);
  assert.equal(labelled(root, 'Reflection note').value, 'Unsaved reflection'); f.h.unmount();
});

test('manual quote keeps its chosen book through list reordering and retains a draft if that book disappears', async () => {
  const calls = [];
  const f = notebookHarness({ books: [{ id: 'book', title: 'A book', currentPage: 1 }, { id: 'other', title: 'Another book', currentPage: 2 }], onAddHighlight: async entry => { calls.push(entry); return true; } });
  let root = f.h.render(f.NotebookView, f.props); labelled(root, 'New quote').onPress(); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Quote text').onChangeText('Keep this quote');
  f.props.books = [...f.props.books].reverse(); root = f.h.render(f.NotebookView, f.props);
  await labelled(root, 'Save new highlight').onPress(); assert.equal(calls[0].bookId, 'book');
  root = f.h.render(f.NotebookView, f.props); labelled(root, 'New quote').onPress(); root = f.h.render(f.NotebookView, f.props);
  labelled(root, 'Quote text').onChangeText('A pending quote'); f.props.books = f.props.books.filter(book => book.id !== 'other'); root = f.h.render(f.NotebookView, f.props);
  assert.equal(labelled(root, 'Save new highlight').disabled, true); await labelled(root, 'Save new highlight').onPress();
  assert.equal(calls.length, 1); assert.equal(labelled(root, 'Quote text').value, 'A pending quote'); assert.match(renderedText(root), /This book is unavailable. Your draft is kept/); f.h.unmount();
});

function settingsChoices(root, label) {
  const choice = elements(root).find(node => typeof node.type === 'function' && node.props?.label === label);
  assert.ok(choice, `Missing settings choice: ${label}`);
  return choice;
}

test('Settings offers Scroll, Pages and Single Line as draft choices and saves only the edited mode', async () => {
  const h = harness({ runEffects: true });
  const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
  const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
  const saved = [], props = { settings: INITIAL_SETTINGS, onSave: async changes => { saved.push(changes); return true; }, onClose() {} };
  let root = h.render(SettingsSheet, props); labelled(root, 'Reading Info').onPress(); root = h.render(SettingsSheet, props);
  for (const label of ['Non-Stop Scroll', 'Page by Page', 'Single Line']) assert.ok(settingsChoices(root, label));
  settingsChoices(root, 'Single Line').props.onPress(); root = h.render(SettingsSheet, props);
  assert.equal(settingsChoices(root, 'Single Line').props.active, true); assert.equal(settingsChoices(root, 'Non-Stop Scroll').props.active, false); assert.equal(saved.length, 0);
  labelled(root, 'Font & Layout').onPress(); root = h.render(SettingsSheet, props);
  labelled(root, 'Reading Info').onPress(); root = h.render(SettingsSheet, props); assert.equal(settingsChoices(root, 'Single Line').props.active, true);
  await labelled(root, 'Keep Changes').onPress(); assert.deepEqual(saved, [{ readingFlowMode: 'single-line' }]); h.unmount();
});

test('new Line choice exposes native button selection and remains locked through a failed settings save', async () => {
  const h = harness({ runEffects: true });
  const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
  const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
  let resolve, closed = 0;
  const props = { settings: INITIAL_SETTINGS, isSheetOnly: true, onSave: () => new Promise(done => { resolve = done; }), onClose: () => closed++ };
  let root = h.render(SettingsSheet, props); labelled(root, 'Reading Info').onPress(); root = h.render(SettingsSheet, props);
  settingsChoices(root, 'Single Line').props.onPress(); root = h.render(SettingsSheet, props);
  const choice = settingsChoices(root, 'Single Line'), native = harness();
  const control = labelled(native.render(choice.type, choice.props), 'Single Line');
  assert.equal(control.accessibilityRole, 'button'); assert.deepEqual(control.accessibilityState, { selected: true });
  const pending = labelled(root, 'Keep Changes').onPress(); root = h.render(SettingsSheet, props);
  assert.equal(settingsChoices(root, 'Single Line').props.disabled, true);
  settingsChoices(root, 'Page by Page').props.onPress(); root = h.render(SettingsSheet, props); assert.equal(settingsChoices(root, 'Single Line').props.active, true);
  resolve(false); await pending; root = h.render(SettingsSheet, props);
  assert.equal(settingsChoices(root, 'Single Line').props.active, true); assert.equal(settingsChoices(root, 'Single Line').props.disabled, false); assert.equal(closed, 0); h.unmount();
});

test('Settings tab selection retains theme drafts and shows the typography preview only on font/theme tabs', async () => {
  const h = harness({ runEffects: true });
  const { SettingsSheet } = h.load('../src/components/SettingsSheet.tsx');
  const { INITIAL_SETTINGS } = h.load('../src/data/initialData.ts');
  let saved;
  const props = { settings: INITIAL_SETTINGS, onSave: async changes => { saved = changes; return true; }, onClose() {} };
  let root = h.render(SettingsSheet, props); assert.match(renderedText(root), /LIVE TYPOGRAPHY PREVIEW/);
  labelled(root, 'Themes').onPress(); root = h.render(SettingsSheet, props);
  assert.deepEqual(labelled(root, 'Themes').accessibilityState, { selected: true });
  for (const label of ['Parchment', 'White', 'Sepia', 'Charcoal']) assert.ok(labelled(root, `${label} page theme`));
  labelled(root, 'Charcoal page theme').onPress(); root = h.render(SettingsSheet, props);
  labelled(root, 'Reading Info').onPress(); root = h.render(SettingsSheet, props); assert.doesNotMatch(renderedText(root), /LIVE TYPOGRAPHY PREVIEW/);
  labelled(root, 'Themes').onPress(); root = h.render(SettingsSheet, props); assert.equal(labelled(root, 'Charcoal page theme').accessibilityState.selected, true);
  assert.match(renderedText(root), /LIVE TYPOGRAPHY PREVIEW/); await labelled(root, 'Keep Changes').onPress(); assert.deepEqual(saved, { theme: 'charcoal' }); h.unmount();
});

function archiveSearchHarness(overrides = {}) {
  const h = harness({ moduleMocks: { './BookCover': { BookCover: 'BookCover' }, './ui/Chip': { Chip: 'Chip' } } });
  const { SearchModal } = h.load('../src/components/SearchModal.tsx');
  const events = [], retries = [];
  const props = { books: [{ id: 'book', title: 'Café Garden', author: 'Zoë', progressPercent: 1, currentPage: 1, lastOpened: 'Not yet read' }],
    bookPages: { book: [{ pageNumber: 1 }] }, globalCoverStyle: 'typographic',
    highlights: [savedHighlight('one', { bookTitle: 'Café Garden', text: 'Morning in the café garden', note: 'A reflection' })],
    lexicon: [vocabularyCard('word', { word: 'Café', definition: 'A coffee shop' })],
    libraryStatus: 'ready', highlightStatus: 'ready', vocabularyStatus: 'ready',
    onRetryHighlights: () => retries.push('quotes'), onRetryVocabulary: () => retries.push('vocabulary'),
    onShowLibrary: () => events.push('library'), onClose: () => events.push('close'),
    onSelectBook: id => events.push(['book', id]), onSelectHighlight: (id, page) => events.push(['quote', id, page]), onSelectVocabulary: entry => events.push(['vocabulary', entry]), ...overrides };
  return { h, props, events, retries, render: () => h.render(SearchModal, props) };
}
const archiveList = root => elements(root).find(node => node.type === 'SectionList').props;
const archiveInput = root => labelled(root, 'Search saved books, quotes, notes and vocabulary');
function archiveRow(root, kind) {
  const list = archiveList(root), item = list.sections.flatMap(section => section.data).find(item => item.kind === kind);
  assert.ok(item, `Missing ${kind} result`); return list.renderItem({ item });
}
const archiveFilter = (root, label) => elements(root).find(node => node.type === 'Chip' && node.props.label === label).props.onPress();

test('global search ignores whitespace, filters categories, and distinguishes clearing text from resetting category', () => {
  const f = archiveSearchHarness(); let root = f.render();
  archiveInput(root).onChangeText('   '); root = f.render(); assert.equal(archiveList(root).sections.length, 0); assert.match(renderedText(archiveList(root).ListEmptyComponent), /Search saved titles/);
  archiveInput(root).onChangeText('CAFE'); root = f.render(); assert.deepEqual(archiveList(root).sections.map(section => section.key), ['books', 'quotes', 'vocabulary']);
  archiveFilter(root, 'Vocabulary'); root = f.render(); assert.deepEqual(archiveList(root).sections.map(section => section.key), ['vocabulary']);
  labelled(root, 'Clear archive search').onPress(); root = f.render(); assert.equal(archiveInput(root).value, '');
  assert.equal(elements(root).find(node => node.type === 'Chip' && node.props.label === 'Vocabulary').props.active, true);
  archiveInput(root).onChangeText('absent'); root = f.render(); assert.match(renderedText(archiveList(root).ListEmptyComponent), /No matches/);
  labelled(archiveList(root).ListEmptyComponent, 'Reset archive search and category').onPress(); root = f.render();
  assert.equal(archiveInput(root).value, ''); assert.equal(elements(root).find(node => node.type === 'Chip' && node.props.label === 'All').props.active, true);
});

test('global book results open details and honor the saved/default cover style instead of blank thumbnails', () => {
  const f = archiveSearchHarness(); let root = f.render(); archiveInput(root).onChangeText('cafe'); root = f.render();
  const row = archiveRow(root, 'book');
  assert.equal(labelled(row, 'Open book details for Café Garden by Zoë').accessibilityRole, 'button');
  assert.equal(elements(row).find(node => node.type === 'BookCover').props.style, 'typographic');
  labelled(row, 'Open book details for Café Garden by Zoë').onPress(); assert.deepEqual(f.events, ['close', ['book', 'book']]);
});

test('quote results jump only to an exact available passage and expose reflection text', () => {
  const f = archiveSearchHarness(); let root = f.render(); archiveInput(root).onChangeText('reflection'); root = f.render();
  const row = archiveRow(root, 'quote'), open = labelled(row, 'Open saved quote from Café Garden at passage 1');
  assert.equal(open.disabled, false); assert.match(renderedText(row), /A reflection/); open.onPress(); assert.deepEqual(f.events, ['close', ['quote', 'book', 1]]);
});

test('missing or unchecked quote text cannot jump and offers Library without dismissing on a disabled action', () => {
  for (const overrides of [{ bookPages: {} }, { books: [] }, { bookPages: { book: [{ pageNumber: 2 }] } }, { libraryStatus: 'loading' }]) {
    const f = archiveSearchHarness(overrides); let root = f.render(); archiveInput(root).onChangeText('reflection'); root = f.render();
    const row = archiveRow(root, 'quote'), open = labelled(row, 'Open saved quote from Café Garden at passage 1');
    assert.deepEqual(open.accessibilityState, { disabled: true }); open.onPress(); assert.deepEqual(f.events, []);
    if (f.props.libraryStatus === 'ready') { labelled(row, 'Find EPUB for Café Garden in Library').onPress(); assert.deepEqual(f.events, ['close', 'library']); }
  }
});

test('global vocabulary results open the exact flashcard and block review when its archive is unavailable', () => {
  const f = archiveSearchHarness(); let root = f.render(); archiveInput(root).onChangeText('coffee'); root = f.render();
  const row = archiveRow(root, 'vocabulary'); labelled(row, 'Review vocabulary card for Café').onPress(); assert.deepEqual(f.events, ['close', ['vocabulary', f.props.lexicon[0]]]);
  f.events.length = 0; f.props.vocabularyStatus = 'error'; root = f.render();
  const blocked = labelled(archiveRow(root, 'vocabulary'), 'Review vocabulary card for Café'); assert.equal(blocked.disabled, true); blocked.onPress(); assert.deepEqual(f.events, []);
});

test('global search reports partial loading/errors with archive retry instead of a false no-matches state', () => {
  const f = archiveSearchHarness({ highlights: [], lexicon: [], highlightStatus: 'error', vocabularyStatus: 'loading' });
  let root = f.render(); archiveInput(root).onChangeText('absent'); root = f.render();
  assert.match(renderedText(archiveList(root).ListHeaderComponent), /Quotes and notes could not be loaded/); assert.match(renderedText(archiveList(root).ListHeaderComponent), /Loading vocabulary/);
  assert.doesNotMatch(renderedText(archiveList(root).ListEmptyComponent), /No matches/);
  labelled(root, 'Retry loading quotes and notes for search').onPress(); assert.deepEqual(f.retries, ['quotes']);
  archiveFilter(root, 'Books'); root = f.render(); assert.match(renderedText(archiveList(root).ListEmptyComponent), /No matches/); assert.doesNotMatch(renderedText(archiveList(root).ListHeaderComponent), /Quotes and notes could not be loaded/);
  labelled(root, 'Close archive search').onPress(); assert.deepEqual(f.events, ['close']);
});

function flashcardReview(overrides = {}) {
  const h = harness({ runEffects: true });
  const { FlashcardModal } = h.load('../src/components/FlashcardModal.tsx');
  const events = [], messages = [];
  const props = { lexiconItem: vocabularyCard('word'), onClose: () => events.push('close'), showToast: message => messages.push(message),
    onUpdateMastery: async (id, level) => { events.push([id, level]); return true; }, ...overrides };
  return { h, props, events, messages, render: () => h.render(FlashcardModal, props) };
}

test('flashcard ratings require recall/reveal and show the saved mastery rather than a fixed preferred rating', async () => {
  const f = flashcardReview(); let root = f.render();
  assert.equal(labelled(root, 'Review: mastery 1 of 5').accessibilityState.selected, true);
  assert.equal(labelled(root, 'Mastered: mastery 5 of 5').accessibilityState.selected, false);
  assert.equal(labelled(root, 'Mastered: mastery 5 of 5').disabled, true);
  await labelled(root, 'Mastered: mastery 5 of 5').onPress(); assert.deepEqual(f.events, []);
  labelled(root, 'Reveal definition for Quietude').onPress(); root = f.render();
  assert.equal(labelled(root, 'Mastered: mastery 5 of 5').disabled, false);
  const definition = elements(root).find(node => node.props?.children === 'Calmness.'); assert.equal(definition.props.selectable, true);
  labelled(root, 'Show word again for Quietude').onPress(); root = f.render(); assert.equal(labelled(root, 'Good: mastery 3 of 5').disabled, true);
  assert.equal(elements(root).some(node => node.props?.children === 'Calmness.'), false); f.h.unmount();
});

test('pending flashcard rating blocks close, backdrop/back dismissal and flipping until acknowledgement', async () => {
  let resolve, calls = 0;
  const f = flashcardReview({ onUpdateMastery: () => { calls++; return new Promise(done => { resolve = done; }); } });
  let root = f.render(); labelled(root, 'Reveal definition for Quietude').onPress(); root = f.render();
  const flip = labelled(root, 'Show word again for Quietude');
  const pending = labelled(root, 'Good: mastery 3 of 5').onPress(); root = f.render();
  assert.equal(labelled(root, 'Close vocabulary card').disabled, true); labelled(root, 'Close vocabulary card').onPress(); root.props.onClose(); flip.onPress();
  await labelled(root, 'Mastered: mastery 5 of 5').onPress(); root = f.render();
  assert.equal(calls, 1); assert.deepEqual(f.events, []); assert.ok(elements(root).some(node => node.props?.children === 'Calmness.'));
  resolve(false); await pending; root = f.render(); assert.equal(labelled(root, 'Close vocabulary card').disabled, false);
  assert.ok(elements(root).some(node => node.props?.accessibilityRole === 'alert' && /Couldn’t save mastery/.test(node.props.children)));
  labelled(root, 'Close vocabulary card').onPress(); assert.deepEqual(f.events, ['close']); f.h.unmount();
});

test('late flashcard rating success, rejection and errors cannot close another card or update an unmounted view', async () => {
  for (const outcome of ['success', 'failure', 'error']) {
    let resolve, reject;
    const f = flashcardReview({ onUpdateMastery: () => new Promise((done, fail) => { resolve = done; reject = fail; }) });
    let root = f.render(); labelled(root, 'Reveal definition for Quietude').onPress(); root = f.render();
    const pending = labelled(root, 'Mastered: mastery 5 of 5').onPress(); f.h.unmount(); const writes = f.h.stateWrites();
    if (outcome === 'error') reject(Error('Storage error')); else resolve(outcome === 'success');
    await pending; assert.deepEqual(f.events, []); assert.deepEqual(f.messages, []); assert.equal(f.h.stateWrites(), writes);
  }
});

test('flashcard archive retry keeps the revealed content and uses updated saved mastery once loaded', () => {
  let retries = 0;
  const f = flashcardReview({ saveStatus: 'error', onRetry: () => retries++ }); let root = f.render();
  labelled(root, 'Reveal definition for Quietude').onPress(); root = f.render();
  assert.equal(labelled(root, 'Good: mastery 3 of 5').disabled, true);
  labelled(root, 'Retry loading vocabulary for this card').onPress(); assert.equal(retries, 1);
  f.props.saveStatus = 'loading'; root = f.render(); assert.match(renderedText(root), /Loading saved vocabulary/);
  f.props.saveStatus = 'ready'; f.props.lexiconItem = { ...f.props.lexiconItem, masteryLevel: 3 }; root = f.render();
  assert.ok(elements(root).some(node => node.props?.children === 'Calmness.'));
  assert.equal(labelled(root, 'Good: mastery 3 of 5').accessibilityState.selected, true); assert.equal(labelled(root, 'Good: mastery 3 of 5').disabled, false); f.h.unmount();
});

test('a removed flashcard remains readable but cannot be rated; unrelated archive work does not trap dismissal', async () => {
  const f = flashcardReview({ cardAvailable: false, lexiconItem: vocabularyCard('word', { contextPassage: '' }) });
  let root = f.render(); labelled(root, 'Reveal definition for Quietude').onPress(); root = f.render();
  assert.match(renderedText(root), /no longer in this reading space/); assert.doesNotMatch(renderedText(root), /In context/);
  await labelled(root, 'Good: mastery 3 of 5').onPress(); assert.deepEqual(f.events, []);
  labelled(root, 'Close vocabulary card').onPress(); assert.deepEqual(f.events, ['close']); f.h.unmount();
  const other = flashcardReview({ saveBusy: true }); root = other.render();
  assert.equal(labelled(root, 'Close vocabulary card').disabled, false); labelled(root, 'Close vocabulary card').onPress(); assert.deepEqual(other.events, ['close']); other.h.unmount();
});

function accountHarness(overrides = {}) {
  const h = harness({ runEffects: true, moduleMocks: {
    '../lib/supabase': { SUPABASE_URL: 'https://test.supabase.co', getAuthRedirectUrl: () => 'folio-dev://auth/callback' },
    './ui/ProgressBar': { ProgressBar: 'ProgressBar' },
  } });
  const { ProfileModal } = h.load('../src/components/ProfileModal.tsx');
  const events = [], messages = [];
  const props = { goal: { streakDays: 0, booksFinishedYear: 0, yearTargetBooks: 12 }, libraryStatus: 'ready', bookCount: 2, user: { id: 'user', fullName: 'Test Reader', email: 'reader@example.test' },
    onClose: () => events.push('close'), onGoogleSignIn: async () => events.push('signin'), onSignOut: async () => events.push('signout'),
    onBackupLibrary: async () => { events.push('backup'); return 2; },
    onRestoreLibrary: async () => ({ restored: 0, alreadyInLibrary: 0, skipped: 0, lookupFailed: 0, failures: [] }),
    showToast: value => messages.push(value), ...overrides };
  return { h, props, events, messages, render: () => h.render(ProfileModal, props) };
}

test('account backup blocks duplicate/overlapping actions and dismissal until acknowledgement', async () => {
  let resolve, calls = 0;
  const f = accountHarness({ onBackupLibrary: () => { calls++; return new Promise(done => { resolve = done; }); } });
  let root = f.render(); const backup = labelled(root, 'Back up library');
  const pending = backup.onPress(); backup.onPress(); root = f.render();
  labelled(root, 'Restore library').onPress(); labelled(root, 'Sign out of Folio').onPress(); labelled(root, 'Close account').onPress(); labelled(root, 'Done with account').onPress(); root.props.onClose();
  assert.equal(calls, 1); assert.deepEqual(f.events, []); assert.equal(labelled(root, 'Back up library').accessibilityState.busy, true);
  resolve(2); await pending; root = f.render(); assert.equal(labelled(root, 'Back up library').disabled, false); assert.match(renderedText(root), /Backed up 2 books/); f.h.unmount();
});

test('account library actions cannot overwrite/restore an unchecked local library', async () => {
  for (const libraryStatus of ['loading', 'error']) {
    const f = accountHarness({ libraryStatus }); const root = f.render();
    for (const label of ['Back up library', 'Restore library']) { const button = labelled(root, label); assert.equal(button.disabled, true); await button.onPress(); }
    assert.deepEqual(f.events, []); assert.equal(labelled(root, 'Close account').disabled, false); f.h.unmount();
  }
});

test('account failures stay visible and permit retry; authentication errors do not automatically open setup instructions', async () => {
  const f = accountHarness({ onBackupLibrary: async () => { throw Error('Backup service unavailable'); } });
  let root = f.render(); await labelled(root, 'Back up library').onPress(); root = f.render();
  assert.ok(elements(root).some(node => node.props?.accessibilityRole === 'alert' && node.props.children === 'Backup service unavailable'));
  assert.equal(labelled(root, 'Back up library').disabled, false); f.h.unmount();
  const other = accountHarness({ user: null, onGoogleSignIn: async () => { throw Error('Connection interrupted'); } }); root = other.render();
  await labelled(root, 'Sign in with Google').onPress(); root = other.render();
  assert.match(renderedText(root), /Connection interrupted/); assert.doesNotMatch(renderedText(root), /Authorized redirect URI/); assert.equal(labelled(root, 'Sign in with Google').disabled, false); other.h.unmount();
});

test('cold-start authentication errors remain readable in Account with sign-in available', () => {
  const f = accountHarness({ user: null, authError: 'Google sign-in was declined. Please try again.' });
  const root = f.render();
  assert.ok(elements(root).some(node => node.props?.accessibilityRole === 'alert' && node.props.children === f.props.authError));
  assert.equal(labelled(root, 'Sign in with Google').disabled, false); f.h.unmount();
});

test('account restore progress/results ignore late callbacks from an earlier operation', async () => {
  let progress, finishBackup;
  const f = accountHarness({ onRestoreLibrary: async callback => { progress = callback; return { restored: 0, alreadyInLibrary: 0, skipped: 0, lookupFailed: 0, failures: [] }; }, onBackupLibrary: () => new Promise(done => { finishBackup = done; }) });
  let root = f.render(); await labelled(root, 'Restore library').onPress(); root = f.render();
  assert.match(renderedText(root), /Restore complete:.*0.*added/);
  const pending = labelled(root, 'Back up library').onPress(); f.render(); const writes = f.h.stateWrites();
  progress({ current: 1, total: 2, percent: 50, title: 'Late book', phase: 'downloading' }); assert.equal(f.h.stateWrites(), writes);
  finishBackup(1); await pending; f.h.unmount();
});

test('account completion/progress after unmount cannot update a different account screen', async () => {
  let complete, progress;
  const f = accountHarness({ onRestoreLibrary: callback => { progress = callback; return new Promise(done => { complete = done; }); } });
  const pending = labelled(f.render(), 'Restore library').onPress(); f.h.unmount(); const writes = f.h.stateWrites();
  progress({ current: 1, total: 1, percent: 100, title: 'Late', phase: 'complete' }); complete(null); await pending;
  assert.equal(f.h.stateWrites(), writes); assert.deepEqual(f.messages, []);
});


test('empty library cannot replace an account backup while restore remains available', async () => {
  const f = accountHarness({ bookCount: 0 }); const root = f.render();
  assert.equal(labelled(root, 'Back up library').disabled, true);
  await labelled(root, 'Back up library').onPress(); assert.deepEqual(f.events, []);
  assert.equal(labelled(root, 'Restore library').disabled, false);
  assert.match(renderedText(root), /empty library will not replace your account backup/); f.h.unmount();
});

test('Notebook keeps infrastructure setup out of the reading workspace and recovers a rejected manual upload', async () => {
  const f = notebookHarness({ cloud: { upsertBookToSupabase: async () => { throw Error('offline'); }, upsertHighlightToSupabase: async () => true, upsertLexiconToSupabase: async () => true } });
  let root = f.h.render(f.NotebookView, f.props); assert.doesNotMatch(renderedText(root), /Supabase|SQL|Database Setup/);
  await labelled(root, 'Upload current records').onPress(); root = f.h.render(f.NotebookView, f.props);
  assert.equal(labelled(root, 'Upload current records').disabled, false); assert.match(f.messages.at(-1), /Device copies are kept/); f.h.unmount();
});

test('book details collapse diagnostic identifiers and expose removal independently of cover editing', async () => {
  const f = libraryHarness({ selectedBookId: 'Amber' }); f.props.books[0] = { ...f.props.books[0], fileLocation: 'file:///private/book.epub', documentIdentifier: 'private-isbn' };
  let root = f.render(); assert.doesNotMatch(renderedText(root), /private-isbn|file:\/\/\/private/);
  labelled(root, 'Technical book details').onPress(); root = f.render(); assert.match(renderedText(root), /private-isbn/);
  labelled(root, 'Manage removal of Amber').onPress(); root = f.render();
  const dialog = elements(root).find(node => typeof node.type === 'function' && node.props?.title === 'Amber'); assert.ok(dialog);
  assert.equal(elements(root).some(node => node.type === f.CoverEditor), false);
  await dialog.props.onRemove(); assert.equal(f.selected.at(-1), null); f.h.unmount();
});

test('safety-copy selection is guarded while checking; restore needs a reviewed copy and preserves settings by default', async () => {
  let choose, copies = [], exported = [];
  const copy = { summary: { books: 2, originals: 1, readable: 2, highlights: 4, vocabulary: 3, bookmarks: 2 } };
  const f = accountHarness({ onChooseSafetyCopy: () => new Promise(done => { choose = done; }), onExportSafetyCopy: originals => exported.push(originals), onRestoreSafetyCopy: (value, preferences, matching) => copies.push([value, preferences, matching]) });
  let root = f.render(); const pending = labelled(root, 'Choose safety copy').onPress(); root = f.render();
  assert.equal(labelled(root, 'Close account').disabled, true); labelled(root, 'Export safety copy').onPress(); assert.deepEqual(exported, []);
  choose(copy); await pending; root = f.render();
  assert.match(renderedText(root), /Review this safety copy/); assert.match(renderedText(root), /Matching identifiers and editions recover missing files/); assert.deepEqual(copies, []);
  labelled(root, 'Recover books from safety copy').onPress(); assert.deepEqual(copies, [[copy, false, true]]);
  labelled(root, 'Recover matching editions without duplicate books').onPress(); root = f.render();
  labelled(root, 'Use reading settings from safety copy').onPress(); root = f.render(); labelled(root, 'Restore safety copy as separate books').onPress(); assert.deepEqual(copies[1], [copy, true, false]);
  labelled(root, 'Cancel safety copy restore').onPress(); root = f.render(); assert.doesNotMatch(renderedText(root), /Review this safety copy/); f.h.unmount();
});

test('safety-copy export respects original-file choice and remains available for Guest', async () => {
  const exported = [];
  const f = accountHarness({ user: null, onChooseSafetyCopy: async () => null, onExportSafetyCopy: value => exported.push(value), onRestoreSafetyCopy: () => {} });
  let root = f.render(); labelled(root, 'Export safety copy').onPress(); assert.deepEqual(exported, [true]);
  labelled(root, 'Include original EPUB files').onPress(); root = f.render(); labelled(root, 'Export safety copy').onPress(); assert.deepEqual(exported, [true, false]);
  await labelled(root, 'Choose safety copy').onPress(); root = f.render(); assert.doesNotMatch(renderedText(root), /Review this safety copy/);
  assert.doesNotMatch(renderedText(root), /Supabase|Client Secret|Cloud Console/); f.h.unmount();
});

test('account-removal retries back off, pause in background, and cancel late work after leaving the reading space', async () => {
  let calls = 0, resolve;
  const h = harness({ runEffects: true, moduleMocks: { './deletionRetries': { retryRecordedDeletions: async () => { calls++; return { pending: 2, failed: 1 }; } } } });
  const { useDeletionRetries } = h.load('../src/lib/useDeletionRetries.ts');
  const props = { storage: {}, cloud: {}, enabled: true };
  const component = () => useDeletionRetries(props.storage, props.cloud, props.enabled, '1:1');
  h.render(component); await new Promise(done => setImmediate(done)); assert.equal(calls, 1); assert.equal([...h.timers.values()][0].ms, 15000);
  h.tick(); await new Promise(done => setImmediate(done)); assert.equal([...h.timers.values()][0].ms, 30000);
  h.appState('background'); assert.equal(h.timers.size, 0); h.appState('active'); await new Promise(done => setImmediate(done)); assert.equal(calls, 3);
  h.unmount(); assert.equal(h.timers.size, 0);
  const late = harness({ runEffects: true, moduleMocks: { './deletionRetries': { retryRecordedDeletions: () => new Promise(done => { resolve = done; }) } } });
  const hook = late.load('../src/lib/useDeletionRetries.ts').useDeletionRetries;
  late.render(() => hook({}, {}, true, '1')); late.unmount(); const writes = late.stateWrites(); resolve({ pending: 1, failed: 1 }); await new Promise(done => setImmediate(done)); assert.equal(late.stateWrites(), writes); assert.equal(late.timers.size, 0);
});

test('Library and other headers keep their bundled offline mark and named Library action', () => {
  const h = harness(); const { Header } = h.load('../src/components/Header.tsx'); const selected = [];
  const props = { activeTab: 'library', onTabChange: value => selected.push(value), onOpenSearch() {}, onOpenProfile() {} };
  const root = h.render(Header, props);
  assert.equal(elements(root).some(node => node.props?.testID === 'folio-header-mark'), true);
  labelled(root, 'Folio Library').onPress(); assert.deepEqual(selected, ['library']);
  const other = h.render(Header, { ...props, activeTab: 'notebook' });
  const mark = elements(other).find(node => node.props?.testID === 'folio-header-mark');
  assert.ok(mark); assert.equal(mark.type, 'Image'); assert.equal(mark.props.source.bundledAsset, path.resolve(__dirname, '../assets/folio-logo.png'));
  assert.equal(fs.existsSync(mark.props.source.bundledAsset), true); assert.equal(mark.props.accessible, false);
});

test('Library rows are virtualized and loading a book keeps its details and blocks duplicate opens', () => {
 const f = libraryHarness({ openingBookId: 'Amber', selectedBookId: 'Amber' });
 let root = f.render(); const read = labelled(root, 'Read Amber'); assert.equal(read.disabled, true); read.onPress(); assert.deepEqual(f.opened, []);
 f.props.openingBookId = null; root = f.render(); labelled(root, 'Read Amber').onPress(); assert.deepEqual(f.opened, ['Amber']); assert.deepEqual(f.selected, []);
 f.props.selectedBookId = null; root = f.render(); const list = elements(root).find(node => node.props?.testID === 'library-collection');
 assert.equal(list.type, 'FlatList'); assert.equal(list.props.data.flat().length, 5); assert.equal(list.props.initialNumToRender, 4); f.h.unmount();
});

test('chapter-relative references open the target and return to the previous reading context', () => {
 const f = scrollingReader();
 f.props().customPages[2].source = { version: 1, edition: 'a'.repeat(64), href: 'EPUB/notes.xhtml', paths: ['body/0/0'] };
 f.props().customPages[2].rich = [{ version: 1, kind: 'paragraph', text: 'A note.', runs: [{ text: 'A note.' }], targets: ['fn1'] }];
 f.settle(); const rendered = f.list().renderItem({ item: f.list().data[0], index: 0 });
 rendered.props.onLink('EPUB/notes.xhtml#fn1'); f.settle(); assert.equal(f.list().data[0].pageNumber, 3);
 labelled(f.render(), 'Back to reference').onPress(); f.settle(); assert.equal(f.list().data[0].pageNumber, 8); f.h.unmount();
});

test('measured Scroll text lines retain a source word through a different typography layout',()=>{
  const f=scrollingReader();f.viewport();f.measure(8,84,1500);
  const block=f.list().renderItem({item:f.list().data[0],index:0});
  block.props.onBlockLines(8,0,[{y:80,height:24,word:0},{y:104,height:24,word:4},{y:128,height:24,word:8}]);
  f.list().onScrollBeginDrag(scrolled(200));f.h.unmount();const saved=f.positions[0].position;
  assert.equal(saved.wordOffset,4);
  const next=scrollingReader({currentBook:{...f.props().currentBook,readingPosition:saved},settings:{...f.props().settings,fontSizeStep:7}});
  next.viewport();next.measure(8,84,2000);
  const rendered=next.list().renderItem({item:next.list().data[0],index:0});
  rendered.props.onBlockLines(8,0,[{y:90,height:32,word:0},{y:122,height:32,word:4},{y:154,height:32,word:8}]);
  assert.deepEqual(next.restored.at(-1),{offset:206,animated:false});
  const before=next.restored.length;block.props.onBlockLines(8,0,[{y:900,height:24,word:4}]);assert.equal(next.restored.length,before);
  next.h.unmount();
});

test('conflict review blocks duplicate choices and dismissal until the durable choice completes; failures retain both versions',async()=>{
 const h=harness({runEffects:true}), {SyncReviewModal}=h.load('../src/components/SyncReviewModal.tsx');
 let complete,calls=0,closed=0;const conflict={kind:'highlight',id:'n',token:'t',device:{text:'Device words',note:'Device thought'},account:{revision:2,payload:{text:'Account words',note:'Account thought'}}};
 const props={conflicts:[conflict],onResolve:()=>{calls++;return new Promise((_,reject)=>{complete=reject;});},onClose:()=>closed++};
 let root=h.render(SyncReviewModal,props);const row=()=>elements(root).find(node=>node.type==='FlatList').props.renderItem({item:conflict});
 labelled(row(),'Use device version').onPress();labelled(row(),'Use account version').onPress();labelled(root,'Close account change review').onPress();assert.equal(calls,1);assert.equal(closed,0);
 root=h.render(SyncReviewModal,props);assert.equal(labelled(row(),'Use account version').disabled,true);
 complete(Error('Storage acknowledgement failed'));await flushJobs();root=h.render(SyncReviewModal,props);
 assert.match(renderedText(root),/Storage acknowledgement failed/);assert.match(renderedText(row()),/Device thought/);assert.match(renderedText(row()),/Account thought/);
 labelled(root,'Close account change review').onPress();assert.equal(closed,1);h.unmount();
});

test('Library bookmark chip stays with collection filters and header search can be expanded and cleared',()=>{
 let opened=0;const f=libraryHarness({bookmarkCount:2,onOpenBookmarks:()=>opened++});let root=f.render();
 labelled(root,'Library bookmarks, 2 saved').onPress();assert.equal(opened,1);
 assert.equal(elements(root).some(node=>node.props?.accessibilityLabel==='Search Library by title or author'),false);
 f.props.searchRequest=1;f.render();root=f.render();labelled(root,'Search Library by title or author').onChangeText('amber');root=f.render();assert.equal(libraryRows(root).length,1);
 labelled(root,'Hide Library search').onPress();root=f.render();assert.equal(libraryRows(root).length,4);assert.equal(elements(root).some(node=>node.props?.accessibilityLabel==='Search Library'),false);f.h.unmount();
});

test('Library-wide bookmarks name their book and open the selected book’s saved record',()=>{
 const h=harness();const {BookmarkSheet}=h.load('../src/components/BookmarkSheet.tsx');const selected=[];
 const items=[{id:'a:1',bookId:'a',pageNumber:1,chapterTitle:'Opening',locNumber:100,excerpt:'First passage'},{id:'b:1',bookId:'b',pageNumber:1,chapterTitle:'Opening',locNumber:100,excerpt:'Second passage'}];
 const root=h.render(BookmarkSheet,{bookmarks:items,currentPage:0,bookTitles:{a:'First book',b:'Second book'},status:'ready',saving:false,onClose(){},onSelect:item=>selected.push(item),onRemove(){},onRetry(){}});
 const list=elements(root).find(node=>node.type==='FlatList');const row=list.props.renderItem({item:items[1]});const open=labelled(row,'Open bookmark, Second book, Opening, location 100. Second passage');
 assert.equal(open.accessibilityState.selected,false);open.onPress();assert.equal(selected[0],items[1]);h.unmount();
});

test('Library combines current reading totals and keeps bookmarks reachable while filtering or searching', () => {
 let opened = 0;
 const f = libraryHarness({ readingGoal: { minutesReadToday: 23, streakDays: 4, booksFinishedYear: 7 }, bookmarkCount: 2, onOpenBookmarks: () => opened++ });
 let root = f.render();
 const summary = elements(root).filter(node => node.props?.testID === 'library-reading-summary');
 assert.equal(summary.length, 1);
 const text = renderedText(summary[0]);
 assert.match(text, /Today’s reading/); assert.match(text, /23 min\s+read today/);
 assert.ok(labelled(summary[0], '4 day streak')); assert.ok(labelled(summary[0], '7 books finished this year'));
 assert.match(text, /Streak/); assert.match(text, /Finished/);
 assert.equal(elements(root).some(node => node.props?.accessibilityLabel === 'Search Library'), false);
 labelled(root, 'Finished').onPress(); root = f.render();
 labelled(root, 'Library bookmarks, 2 saved').onPress(); assert.equal(opened, 1);
 assert.equal(labelled(root, 'Finished').accessibilityState.selected, true);
 f.props.searchRequest = 1; f.render(); root = f.render();
 labelled(root, 'Library bookmarks, 2 saved').onPress(); assert.equal(opened, 2);
 assert.ok(labelled(root, 'Search Library by title or author'));
 labelled(root, 'Hide Library search').onPress(); root = f.render();
 assert.ok(labelled(root, 'Resume Brook by An Author')); f.h.unmount();
});

test('book-list restore distinguishes recovered books from unavailable reading passages', async () => {
 const f = accountHarness({ onRestoreLibrary: async () => ({ restored: 2, alreadyInLibrary: 1, skipped: 0, lookupFailed: 0, failures: [], readingPositionsNotRestored: 2 }) });
 let root = f.render();
 assert.match(renderedText(root), /Book list backup/);
 assert.match(renderedText(root), /excludes EPUB files, notes and bookmarks/);
 await labelled(root, 'Restore library').onPress(); root = f.render();
 assert.match(renderedText(root), /2\s+books were\s+added at the beginning/);
 assert.match(renderedText(root), /account backup was kept unchanged/);
 assert.match(f.messages.at(-1), /2 saved passages were unavailable/);
 f.h.unmount();
});

test('free-book grid and list cards open details without Get or Read buttons and expose library membership', () => {
 const f = catalogHarness();
 for (const viewMode of ['grid', 'list']) for (const inLibrary of [false, true]) {
  let details = 0;
  const row = f.h.render(f.BookRow.type, { item: f.item, status: inLibrary ? 'added' : 'get', inLibrary, disabled: false, progressPercent: null, viewMode, cardWidth: 160, onDetails: () => details++, onGet: () => assert.fail('Details should own the download action') });
  assert.equal(elements(row).find(node => node.type === 'BookCover').props.inLibrary, inLibrary);
  assert.equal(elements(row).some(node => /^(Add |Read )/.test(node.props?.accessibilityLabel ?? '')), false);
  const cover = labelled(row, 'View details for A Book by An Author');
  assert.equal(cover.accessibilityHint, inLibrary ? 'Already in your library' : 'View book details and download options');
  cover.onPress(); labelled(row, 'About A Book').onPress(); assert.equal(details, 2);
 }
 f.h.unmount();
});

test('catalog membership covers saved mappings and imported works without pretending unavailable EPUBs are readable', async () => {
 const f = catalogHarness({ added: { 'gutenberg-1': 'owned' } });
 f.props.books = [{ id: 'owned', title: 'A Book', author: 'An Author' }];
 f.render(); await flushNative(); let root = f.render();
 assert.equal(freeBookRow(f, root).inLibrary, true); assert.equal(freeBookRow(f, root).status, 'get');
 f.props.availableBookIds = ['owned']; root = f.render();
 assert.equal(freeBookRow(f, root).inLibrary, true); assert.equal(freeBookRow(f, root).status, 'added');
 f.props.books = []; root = f.render(); assert.equal(freeBookRow(f, root).inLibrary, false);
 f.props.books = [{ id: 'imported', title: 'A BOOK!', author: 'An Author' }]; root = f.render();
 assert.equal(freeBookRow(f, root).inLibrary, true);
 f.props.books = [{ id: 'another-work', title: 'A Book', author: 'Another Author' }]; root = f.render();
 assert.equal(freeBookRow(f, root).inLibrary, false); f.h.unmount();
});

test('library membership only appears after a confirmed catalog import', async () => {
 let finish;
 const f = catalogHarness({ save: () => new Promise(done => { finish = done; }) });
 f.render(); await flushNative(); let root = f.render();
 freeBookRow(f, root).onGet(f.item); await flushNative(); fireNativeTimer(f.h, 60); await flushNative(); root = f.render();
 assert.equal(freeBookRow(f, root).inLibrary, false);
 finish(); await flushNative(); root = f.render(); assert.equal(freeBookRow(f, root).inLibrary, true);
 f.h.unmount();
});

test('cover membership badge has a readable label and coexists with reading progress and fallback art', () => {
 const h = harness({ runEffects: true, moduleMocks: { 'expo-linear-gradient': { LinearGradient: 'LinearGradient' } } });
 const { BookCover } = h.load('../src/components/BookCover.tsx');
 const props = { book: { title: 'A Book', author: 'An Author', coverUrl: '', coverAlt: 'A book cover' }, style: 'image', variant: 'library', inLibrary: true, badge: { kind: 'percent', value: 32 } };
 let root = h.render(BookCover, props);
 assert.ok(labelled(root, 'In your library')); assert.match(renderedText(root), /32/);
 assert.ok(elements(root).some(node => node.type === 'CoverIllustration'));
 root = h.render(BookCover, { ...props, inLibrary: false });
 assert.equal(elements(root).some(node => node.props?.accessibilityLabel === 'In your library'), false); h.unmount();
});

test('Google Books opens key setup instead of sending unauthenticated searches; replace/remove cancel old access', async () => {
 const f = catalogHarness(); f.render(); await flushNative(); let root = f.render();
 labelled(root, 'Google Books').onPress(); root = f.render();
 assert.ok(labelled(elements(root).find(node => node.type === 'FlatList').props.ListEmptyComponent, 'Set up Google Books'));
 assert.equal(f.calls.searches.filter(call => call.opts.source === 'google').length, 0);
 labelled(root, 'Google Books setup').onPress(); root = f.render();
 const setup = elements(root).find(node => node.type?.name === 'GoogleBooksSetup').props;
 setup.onSaved('reader-key-01234567890123456789'); setup.onClose(); f.render(); await flushNative(); root = f.render();
 const request = f.calls.searches.find(call => call.opts.source === 'google');
 assert.equal(request.opts.googleBooksKey, 'reader-key-01234567890123456789');
 labelled(root, 'Google Books setup').onPress(); root = f.render();
 const remove = elements(root).find(node => node.type?.name === 'GoogleBooksSetup').props;
 remove.onSaved(null); remove.onClose(); root = f.render();
 assert.equal(request.signal.aborted, true);
 assert.ok(labelled(elements(root).find(node => node.type === 'FlatList').props.ListEmptyComponent, 'Set up Google Books')); f.h.unmount();
});

function googleSetupHarness(overrides={}) {
 const h=harness({runEffects:true});const {GoogleBooksSetup}=h.load('../src/components/GoogleBooksSetup.tsx');const events=[];
 const props={store:{save:async key=>key,remove:async()=>{}},hasKey:false,loading:false,loadError:false,onRetry:()=>events.push('retry'),onSaved:key=>events.push(key),onClose:()=>events.push('close'),...overrides};
 return{h,props,events,render:()=>h.render(GoogleBooksSetup,props)};
}
test('Google key entry is masked, validates drafts and blocks repeated writes/dismissal until confirmed',async()=>{
 let finish,calls=0;const f=googleSetupHarness({store:{save:key=>{calls++;return new Promise(done=>{finish=()=>done(key);});},remove:async()=>{}}});let root=f.render();
 assert.equal(labelled(root,'Google Books API key').secureTextEntry,true);assert.equal(labelled(root,'Save Google Books key').disabled,true);
 labelled(root,'Google Books API key').onChangeText('reader-key-01234567890123456789');root=f.render();
 const pending=labelled(root,'Save Google Books key').onPress();labelled(root,'Save Google Books key').onPress();labelled(root,'Close Google Books setup').onPress();
 assert.equal(calls,1);assert.deepEqual(f.events,[]);finish();await pending;
 assert.deepEqual(f.events,['reader-key-01234567890123456789','close']);f.h.unmount();
});
test('Google key failures retain the draft and late success cannot update another reading space',async()=>{
 const f=googleSetupHarness({store:{save:async()=>{throw Error('Native acknowledgement failed');},remove:async()=>{}}});let root=f.render();
 labelled(root,'Google Books API key').onChangeText('reader-key-01234567890123456789');root=f.render();await labelled(root,'Save Google Books key').onPress();root=f.render();
 assert.equal(labelled(root,'Google Books API key').value,'reader-key-01234567890123456789');assert.ok(elements(root).some(node=>node.props?.accessibilityRole==='alert'));assert.deepEqual(f.events,[]);f.h.unmount();
 let done;const other=googleSetupHarness({hasKey:true,store:{save:async key=>key,remove:()=>new Promise(resolve=>{done=resolve;})}});root=other.render();
 const pending=labelled(root,'Remove Google Books key').onPress();other.h.unmount();done();await pending;assert.deepEqual(other.events,[]);
});
test('an unreadable key cannot be replaced or removed until secure storage is checked again',async()=>{
 const f=googleSetupHarness({hasKey:true,loadError:true});let root=f.render();
 assert.equal(labelled(root,'Google Books API key').editable,false);assert.equal(labelled(root,'Remove Google Books key').disabled,true);
 await labelled(root,'Remove Google Books key').onPress();assert.deepEqual(f.events,[]);
 labelled(root,'Retry loading Google Books key').onPress();assert.deepEqual(f.events,['retry']);f.h.unmount();
});

test('informational source notices do not pretend a healthy catalog needs recovery',async()=>{
 const f=catalogHarness({search:async()=>({books:[],hasMore:true,total:null,notice:'Only confirmed EPUBs are shown.',noticeKind:'info'})});f.render();await flushNative();labelled(f.render(),'Standard Ebooks').onPress();f.render();await flushNative();const root=f.render();
 const list=freeBookList(root);assert.equal(elements(list.ListHeaderComponent).some(node=>node.props?.accessibilityLabel==='Retry live catalog'),false);
 assert.match(renderedText(list.ListEmptyComponent),/No EPUB listings on this page/);assert.equal(list.onEndReached,undefined);assert.ok(labelled(list.ListFooterComponent,'Load more books'));f.h.unmount();
});

function epubSourcesHarness(checker, overrides = {}) {
 const calls = [], gets = [], setups = [];
 const sources = ['gutenberg','standard','archive','google','oapen','doab','wikisource','feedbooks'].map(id=>({id,label:id}));
 const h=harness({runEffects:true,moduleMocks:{'../lib/catalog':{CATALOG_SOURCES:sources,
  checkDiscoverySource:async(book,source,signal,access)=>{calls.push({book,source,signal,access});return checker?checker(book,source,signal,access):{source,state:'not-found',editions:[]};}}}});
 const {EpubSources}=h.load('../src/components/EpubSources.tsx');
 const props={book:{id:'openlibrary-OL1W',catalogKind:'work',title:'A Book',author:'An Author',coverUrl:'https://covers.openlibrary.org/b/id/1-L.jpg',subjects:[]},googleKey:null,keyLoading:false,disabled:false,errors:{},onGet:b=>gets.push(b),onSetupGoogle:()=>setups.push(true),...overrides};
 return {h,props,calls,gets,setups,render:()=>h.render(EpubSources,props)};
}
test('EPUB checks run with bounded concurrency and failures stay distinct from no match while other sources finish', async()=>{
 const pending=new Map();let concurrent=0,max=0;
 const f=epubSourcesHarness(async(_book,source)=>{concurrent++;max=Math.max(max,concurrent);await new Promise(resolve=>pending.set(source,resolve));concurrent--;return {source,state:source==='standard'?'error':source==='google'?'key-required':'not-found',editions:[],message:source==='standard'?'Source offline':undefined};});
 f.render();assert.equal(f.calls.length,3);assert.equal(max,3);
 for(let turn=0;turn<4;turn++){for(const done of pending.values())done();pending.clear();await flushNative();}
 const root=f.render();assert.equal(f.calls.length,8);assert.equal(max,3);assert.match(renderedText(root),/Could not check this source/);assert.match(renderedText(root),/No matching EPUB found in this check/);
 assert.ok(labelled(root,'Retry EPUB check for standard'));labelled(root,'Google Books setup').onPress();assert.equal(f.setups.length,1);
 assert.equal(elements(root).some(n=>n.props?.accessibilityLabel?.startsWith('Download A Book')),false);
 f.h.unmount();for(const done of pending.values())done();
});
test('source download buttons emit the selected edition and Open Library cover, retain errors, and block during a transfer',async()=>{
 const edition={id:'standard-a',source:'standard',title:'A Book',author:'An Author',coverUrl:'https://standardebooks.org/source.jpg',subjects:[],description:'Source description'};
 const f=epubSourcesHarness(async(_book,source)=>({source,state:source==='standard'?'available':source==='google'?'key-required':'not-found',editions:source==='standard'?[edition]:[]}));
 f.render();await flushNative();let root=f.render();labelled(root,'Download A Book from standard').onPress();assert.equal(f.gets.length,1);
 assert.equal(f.gets[0].id,'standard-a');assert.equal(f.gets[0].discoveryWorkId,'openlibrary-OL1W');assert.equal(f.gets[0].coverUrl,f.props.book.coverUrl);assert.equal(f.gets[0].useDiscoveryCover,true);
 f.props.errors={'standard-a':'Transfer failed'};root=f.render();assert.match(renderedText(root),/Transfer failed/);
 f.props.disabled=true;root=f.render();const button=labelled(root,'Download A Book from standard');assert.equal(button.disabled,true);button.onPress();assert.equal(f.gets.length,1);
 labelled(root,'Google Books setup').onPress();assert.equal(f.setups.length,0);
 f.props.disabled=false;f.props.book={...f.props.book,coverUrl:''};root=f.render();labelled(root,'Download A Book from standard').onPress();assert.equal(f.gets[1].coverUrl,'');f.h.unmount();
});
test('retry checks one provider and a late result cannot update a different book or an unmounted detail screen',async()=>{
 let late;
 const f=epubSourcesHarness(async(_book,source)=>({source,state:'error',editions:[],message:'Offline'}));
 f.render();await flushNative();let root=f.render();const count=f.calls.length;labelled(root,'Retry EPUB check for standard').onPress();await flushNative();root=f.render();assert.equal(f.calls.length,count+1);assert.equal(f.calls.at(-1).source,'standard');f.h.unmount();
 const pending=epubSourcesHarness((_book,source)=>new Promise(resolve=>{if(!late)late=()=>resolve({source,state:'not-found',editions:[]});}));pending.render();const old=pending.calls[0];
 pending.props.book={...pending.props.book,id:'openlibrary-OL2W'};pending.render();assert.equal(old.signal.aborted,true);
 const before=pending.h.stateWrites();late();await flushNative();assert.equal(pending.h.stateWrites(),before);
 pending.h.unmount();const writes=pending.h.stateWrites();assert.ok(pending.calls.every(call=>call.signal.aborted));await flushNative();assert.equal(pending.h.stateWrites(),writes);
});
test('changing Google access aborts older source checks and exposes key management for rejected credentials',async()=>{
 let late;
 const f=epubSourcesHarness(async(_book,source,_signal,access)=>{
  if(source==='google'&&access.googleBooksKey==='reader-one-synthetic-key')await new Promise(resolve=>{late=resolve;});
  return {source,state:source==='google'?'error':'not-found',editions:[],message:'Authorization could not be confirmed'};
 },{googleKey:'reader-one-synthetic-key'});
 f.render();await flushNative();let root=f.render();
 const first=f.calls.find(call=>call.source==='google');f.props.googleKey='reader-two-synthetic-key';f.render();await flushNative();root=f.render();assert.equal(first.signal.aborted,true);assert.ok(labelled(root,'Google Books setup'));late();await flushNative();
 assert.equal(f.calls.filter(call=>call.source==='google').at(-1).access.googleBooksKey,'reader-two-synthetic-key');assert.doesNotMatch(renderedText(root),/reader-one-synthetic|reader-two-synthetic/);f.h.unmount();
});
test('general book details expose source choices without offering a metadata record as a download',async()=>{
 const f=catalogHarness({item:{id:'openlibrary-OL1W',source:'openlibrary',catalogKind:'work',openLibraryWorkId:'OL1W',coverUrl:'',downloads:0}});
 f.render();await flushNative();let root=f.render();assert.equal(f.calls.searches[0].opts.source,'all');assert.equal(labelled(root,'All books').accessibilityState.selected,true);
 freeBookRow(f,root).onDetails(f.item);f.render();await flushNative();root=f.render();
 assert.equal(f.calls.downloads.length,0);assert.equal(elements(root).some(n=>n.props?.accessibilityLabel==='Add A Book to library'),false);
 assert.ok(elements(root).find(n=>n.type?.name==='EpubSources'));assert.equal(elements(root).find(n=>n.type==='BookCover').props.fallback,'typographic');
 labelled(root,'Back to books').onPress();root=f.render();assert.ok(labelled(root,'All books'));f.h.unmount();
});
test('downloading a chosen source links both the work and edition and applies Open Library artwork before embedded art',async()=>{
 for(const coverUrl of ['https://covers.openlibrary.org/b/id/1-L.jpg','']){
  const f=catalogHarness({item:{id:'openlibrary-OL1W',source:'openlibrary',catalogKind:'work',openLibraryWorkId:'OL1W',coverUrl,downloads:0}});
  f.render();await flushNative();let root=f.render();freeBookRow(f,root).onDetails(f.item);f.render();await flushNative();root=f.render();
  const sources=elements(root).find(n=>n.type?.name==='EpubSources').props;
  sources.onGet({id:'standard-a',source:'standard',title:'A Book',author:'An Author',subjects:[],description:'A description',discoveryWorkId:f.item.id,useDiscoveryCover:true,coverUrl});
  await flushNative();fireNativeTimer(f.h,60);await flushNative();root=f.render();
  assert.equal(f.calls.downloads[0][0].source,'standard');assert.equal(f.calls.saved.length,1);assert.equal(f.calls.saved[0].book.coverStyle,coverUrl?'image':'typographic');
  if(coverUrl)assert.equal(f.calls.saved[0].book.coverUrl,coverUrl);
  assert.equal(freeBookRow(f,root).status,'added');labelled(root,'Read A Book').onPress();assert.deepEqual(f.calls.opened,['epub-new']);f.h.unmount();
 }
});
test('catalog cover images fall back to typography on missing/failed art and recover when the Open Library URL changes',()=>{
 const h=harness({runEffects:true,moduleMocks:{'expo-linear-gradient':{LinearGradient:'LinearGradient'}}});const {BookCover}=h.load('../src/components/BookCover.tsx');
 let props={book:{title:'A Book',author:'An Author',coverUrl:'',coverAlt:'Cover'},style:'image',fallback:'typographic',inLibrary:true};
 let root=h.render(BookCover,props);assert.equal(elements(root).some(n=>n.type==='Image'||n.type==='CoverIllustration'),false);assert.match(renderedText(root),/A Book/);
 props={...props,book:{...props.book,coverUrl:'https://covers.openlibrary.org/b/id/1-L.jpg'}};root=h.render(BookCover,props);assert.ok(elements(root).find(n=>n.type==='Image'));
 elements(root).find(n=>n.type==='Image').props.onError();root=h.render(BookCover,props);assert.equal(elements(root).some(n=>n.type==='Image'||n.type==='CoverIllustration'),false);assert.ok(labelled(root,'In your library'));
 props={...props,book:{...props.book,coverUrl:'https://covers.openlibrary.org/b/id/2-L.jpg'}};root=h.render(BookCover,props);assert.ok(elements(root).find(n=>n.type==='Image'));h.unmount();
});

test('compact book controls keep subjects and sorting in menus with selected values and retain search on cancel',async()=>{
 const f=catalogHarness();f.render();await flushNative();let root=f.render();
 assert.equal(elements(root).some(node=>node.props?.accessibilityLabel==='Sort books by Title'),false);
 assert.equal(elements(root).some(node=>node.props?.accessibilityLabel==='Fiction'),false);
 assert.equal(labelled(root,'Sort books').accessibilityValue.text,'Trending now');
 assert.equal(labelled(root,'Choose book subjects').accessibilityValue.text,'All subjects');
 labelled(root,'Search books by title or author').onChangeText('shelley');root=f.render();
 labelled(root,'Sort books').onPress();root=f.render();assert.equal(labelled(root,'Sort books').accessibilityState.expanded,true);
 assert.ok(labelled(root,'Sort books by Title'));labelled(root,'Close book filters').onPress();root=f.render();assert.equal(labelled(root,'Search books by title or author').value,'shelley');
 labelled(root,'Choose book subjects').onPress();root=f.render();assert.ok(labelled(root,'Fiction'));root.props.onRequestClose();root=f.render();assert.equal(labelled(root,'Choose book subjects').accessibilityState.expanded,false);
 assert.equal(labelled(root,'Search books by title or author').value,'shelley');f.h.unmount();
});
test('subject and sort selection expose full options and large text gives controls space to wrap',async()=>{
 const f=catalogHarness();f.h.native.useWindowDimensions=()=>({width:320,height:640,fontScale:1.6});f.render();await flushNative();let root=f.render();
 const sort=labelled(root,'Sort books');assert.equal(sort.style[0].minHeight,48);assert.equal(sort.style[1].flexBasis,'44%');
 labelled(root,'Choose book subjects').onPress();root=f.render();const menu=elements(root).find(node=>node.type==='ModalShell');assert.ok(menu.props.cardStyle.height<=640*.75);
 labelled(root,'Fiction').onPress();root=f.render();await flushNative();root=f.render();assert.equal(f.calls.searches.at(-1).opts.topic,'fiction');assert.equal(labelled(root,'Choose book subjects').accessibilityValue.text,'Fiction');
 labelled(root,'Sort books').onPress();root=f.render();assert.ok(labelled(root,'Sort books by Title'));labelled(root,'Sort books by Title').onPress();root=f.render();assert.equal(labelled(root,'Sort books').accessibilityValue.text,'Title');f.h.unmount();
});
test('saved search results can render while a refresh is pending and stale callbacks cannot replace a newer query',async()=>{
 const requests=[];const f=catalogHarness({search:(opts,signal)=>new Promise(resolve=>requests.push({opts,signal,resolve}))});f.render();let root=f.render();
 requests[0].opts.onCached({books:[{...f.item,id:'openlibrary-OL1W'}],hasMore:false,total:1,notice:'Showing saved results while refreshing.',noticeKind:'info'});root=f.render();assert.equal(freeBookList(root).data[0].id,'openlibrary-OL1W');
 labelled(root,'Search books by title or author').onChangeText('another');f.render();fireNativeTimer(f.h,450);f.render();assert.equal(requests[0].signal.aborted,true);
 const before=f.h.stateWrites();requests[0].opts.onCached({books:[f.item],hasMore:false,total:1});assert.equal(f.h.stateWrites(),before);
 requests[1].resolve({books:[{...f.item,id:'openlibrary-OL2W'}],hasMore:false,total:1});await flushNative();root=f.render();assert.equal(freeBookList(root).data[0].id,'openlibrary-OL2W');f.h.unmount();
});
test('Open Library timeout recovery stays actionable and saved results show a refresh action instead of a fatal empty state',async()=>{
 const {CatalogError}=require('./loadTypeScript.cjs').loadTypeScript('./src/lib/catalogRequest.ts');const f=catalogHarness({search:async()=>{throw new CatalogError('timeout');}});f.render();await flushNative();let root=f.render();
 assert.match(renderedText(freeBookList(root).ListEmptyComponent),/Open Library took too long/);assert.ok(labelled(freeBookList(root).ListEmptyComponent,'Retry catalog'));assert.ok(labelled(root,'Project Gutenberg'));f.h.unmount();
 const saved=catalogHarness({search:async()=>({books:[{id:'openlibrary-OL1W',source:'openlibrary',catalogKind:'work',title:'Saved book',author:'Author',subjects:[],coverUrl:'',epubUrl:''}],hasMore:false,total:1,notice:'Open Library could not refresh. Showing saved books.',noticeKind:'recovery'})});saved.render();await flushNative();root=saved.render();assert.equal(freeBookList(root).data.length,1);assert.ok(labelled(root,'Retry live catalog'));saved.h.unmount();
});
test('shared shelf chips use compact rounded rectangles inside full touch targets',()=>{
 const h=harness();const {renderShelfChip}=h.load('../src/components/ui/ShelfControls.tsx');const chip=renderShelfChip({primaryContainer:'#111',surfaceContainer:'#eee',onPrimaryContainer:'#fff',onSurface:'#111'},'Fiction',true,()=>{});
 assert.equal(chip.props.style.minHeight,48);const face=elements(chip).find(node=>node.type==='View');assert.equal(face.props.style[0].borderRadius,8);assert.ok(face.props.style[0].minHeight<=30);assert.equal(chip.props.accessibilityState.selected,true);
});

test('loading placeholders follow two/three columns and list mode while the catalog request is pending',()=>{
 const f=catalogHarness({search:()=>new Promise(()=>{})});let root=f.render();
 let loading=freeBookList(root).ListEmptyComponent;assert.equal(loading.type.name,'BookShelfLoading');assert.equal(loading.props.viewMode,'grid');assert.equal(loading.props.columns,2);
 const wide=loading.props.cardWidth;labelled(root,'3-column grid').onPress();root=f.render();loading=freeBookList(root).ListEmptyComponent;
 assert.equal(loading.props.columns,3);assert.ok(loading.props.cardWidth<wide);
 labelled(root,'List view').onPress();root=f.render();loading=freeBookList(root).ListEmptyComponent;assert.equal(loading.props.viewMode,'list');f.h.unmount();
});
test('shelf placeholders use real cover proportions, correct grid widths and one accessible busy state',()=>{
 const h=harness();const {BookShelfLoading}=h.load('../src/components/BookShelfLoading.tsx');
 for(const columns of [2,3]){
  const root=h.render(BookShelfLoading,{viewMode:'grid',columns,cardWidth:columns===2?172:109});
  const cards=elements(root).filter(node=>node.props?.testID==='book-loading-grid-card');assert.equal(cards.length,columns*3);assert.ok(cards.every(card=>card.props.style.width===(columns===2?172:109)));
  const covers=elements(root).filter(node=>node.props?.testID==='book-loading-cover');assert.ok(covers.every(cover=>cover.props.style[1].aspectRatio===2/3));
  assert.equal(elements(root).some(node=>node.props?.testID==='book-loading-list-row'),false);assert.equal(root.props.accessibilityState.busy,true);assert.equal(root.props.accessibilityValue.text,`${columns}-column grid`);
  assert.equal(elements(root).filter(node=>node.props?.accessibilityLabel==='Loading books').length,1);
 }
 const list=h.render(BookShelfLoading,{viewMode:'list',columns:1,cardWidth:360});assert.equal(elements(list).filter(node=>node.props?.testID==='book-loading-list-row').length,5);
 const more=h.render(BookShelfLoading,{viewMode:'grid',columns:3,cardWidth:109,rows:1,more:true});assert.equal(elements(more).filter(node=>node.props?.testID==='book-loading-grid-card').length,3);assert.equal(more.props.accessibilityLabel,'Loading more books');
});
test('pagination loading uses the same selected shelf layout and trending counts do not claim a full-catalog total',async()=>{
 let next;const f=catalogHarness({search:async opts=>opts.page===1?{books:[{id:'openlibrary-OL1W',catalogKind:'work',source:'openlibrary',title:'A Book',author:'An Author',subjects:[],coverUrl:'',epubUrl:''}],hasMore:true,total:null,collection:'trending'}:new Promise(resolve=>{next=resolve;})});
 f.render();await flushNative();let root=f.render();assert.match(renderedText(freeBookList(root).ListHeaderComponent),/Trending books/);assert.match(renderedText(freeBookList(root).ListHeaderComponent),/1 book loaded/);
 freeBookList(root).onEndReached();root=f.render();let loading=freeBookList(root).ListFooterComponent;assert.equal(loading.type.name,'BookShelfLoading');assert.equal(loading.props.columns,2);assert.equal(loading.props.rows,1);assert.equal(loading.props.more,true);
 labelled(root,'3-column grid').onPress();root=f.render();loading=freeBookList(root).ListFooterComponent;assert.equal(loading.props.columns,3);next({books:[],hasMore:false,total:null,collection:'trending'});await flushNative();f.h.unmount();
});
