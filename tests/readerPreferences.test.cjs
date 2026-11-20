const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

function load(relativePath, dependencies = {}) {
  const filename = path.resolve(__dirname, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : originalRequire(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return loaded.exports;
}
const preferences = load('../src/lib/readerPreferences.ts');
const { normalizeTypeface, normalizeReaderSettings, readerTextMetrics, READER_FONTS } = preferences;
const { HIGHLIGHT_COLORS, highlightTextStyle } = load('../src/lib/highlights.ts');

for (const platform of ['android', 'ios']) {
  test(`every advertised typeface resolves to its actual bundled or system font on ${platform}`, () => {
    const theme = load('../src/theme.ts', {
      'react-native': { Platform: { select: options => options[platform] ?? options.default } },
      './lib/readerPreferences': preferences,
    });
    assert.deepEqual(READER_FONTS, ['Literata', 'EB Garamond', 'Manrope', 'System Serif', 'System Sans']);
    const expected = ['Literata_400Regular', 'EBGaramond_400Regular', 'Manrope_400Regular', platform === 'ios' ? 'Georgia' : 'serif', undefined];
    assert.deepEqual(READER_FONTS.map(font => theme.readerFontFamily(font)), expected);
    assert.equal(theme.previewPaper, theme.readerPaper);
  });
}

for (const [oldName, replacement] of [
  ['Bookerly', 'System Serif'], ['Georgia', 'System Serif'],
  ['Inter', 'Manrope'], ['OpenDyslexic', 'System Sans'],
]) {
  test(`migrates saved ${oldName} to ${replacement} without advertising the old alias`, () => {
    assert.equal(normalizeTypeface(oldName), replacement);
    assert.ok(!READER_FONTS.includes(oldName));
  });
}

test('canonical font names survive normalization; unknown values have an available fallback', () => {
  for (const font of READER_FONTS) assert.equal(normalizeTypeface(font), font);
  for (const font of [null, undefined, '', 'uninstalled-font', {}]) assert.equal(normalizeTypeface(font), 'Literata');
});

test('old settings keep other reading preferences while disabling unsupported publisher layout', () => {
  const old = { font: 'Inter', fontSizeStep: 7, lineSpacing: 'loose', theme: 'charcoal', margins: 'wide', usePublisherDefaults: true, displayReadingPace: false, readingFlowMode: 'paginated' };
  const next = normalizeReaderSettings(old);
  assert.deepEqual(next, { ...old, font: 'Manrope', usePublisherDefaults: false, defaultCoverStyle: 'image', wpm: 240 });
  assert.equal(old.font, 'Inter');
  assert.equal(old.usePublisherDefaults, true);
  assert.deepEqual(normalizeReaderSettings(next), next);
});

test('preview/reader metrics retain fractional font sizes and use the actual reader spacing', () => {
  assert.deepEqual(readerTextMetrics({ fontSizeStep: 1, lineSpacing: 'standard' }), { fontSize: 15.5, lineHeight: 26 });
  assert.deepEqual(readerTextMetrics({ fontSizeStep: 4, lineSpacing: 'compact' }), { fontSize: 20, lineHeight: 29 });
  assert.deepEqual(readerTextMetrics({ fontSizeStep: 4, lineSpacing: 'standard' }), { fontSize: 20, lineHeight: 34 });
  assert.deepEqual(readerTextMetrics({ fontSizeStep: 8, lineSpacing: 'loose' }), { fontSize: 26, lineHeight: 52 });
});

test('invalid saved size/spacing values do not create unreadable metrics', () => {
  assert.equal(readerTextMetrics({ fontSizeStep: -2, lineSpacing: 'standard' }).fontSize, 15.5);
  assert.equal(readerTextMetrics({ fontSizeStep: 100, lineSpacing: 'standard' }).fontSize, 26);
  for (const lineSpacing of ['unknown', 'toString', '__proto__']) {
    assert.deepEqual(readerTextMetrics({ fontSizeStep: NaN, lineSpacing }), { fontSize: 20, lineHeight: 34 });
  }
});

// Independent contrast calculation against the style returned to the actual UI.
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
  const linear = rgb.map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(style) {
  const [dark, light] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => a - b);
  return (light + 0.05) / (dark + 0.05);
}
for (const entry of HIGHLIGHT_COLORS) {
  test(`${entry.label} selected and saved text has at least 4.5:1 contrast, including Charcoal mode`, () => {
    const style = highlightTextStyle(entry.hex);
    assert.equal(style.backgroundColor, entry.hex);
    assert.match(style.backgroundColor, /^#[0-9a-f]{6}$/i);
    assert.ok(contrast(style) >= 4.5);
  });
}
for (const background of ['#000000', '#ffffff', '#777777', '#808080', '#123456']) {
  test(`existing custom highlight ${background} remains legible`, () => {
    assert.ok(contrast(highlightTextStyle(background)) >= 4.5);
  });
}

test('invalid saved highlight colors get a valid legible fallback', () => {
  for (const color of ['', '#fff', 'not a color', '#F8E8A2dd']) {
    const style = highlightTextStyle(color);
    assert.equal(style.backgroundColor, HIGHLIGHT_COLORS[0].hex);
    assert.ok(contrast(style) >= 4.5);
  }
});


test('all saved preference fields are validated, bounded and stripped of unknown keys', () => {
  const invalid = { theme: '__proto__', font: 'constructor', fontSizeStep: '8', lineSpacing: 'toString',
    margins: {}, displayReadingPace: 'false', defaultCoverStyle: 'unknown', readingFlowMode: 'flying',
    wpm: Infinity, usePublisherDefaults: true, secret: 'discard' };
  assert.deepEqual(normalizeReaderSettings(invalid), preferences.DEFAULT_READER_SETTINGS);
  for (const value of [null, [], 'saved', undefined, Object.create({ theme: 'charcoal', fontSizeStep: 8 })]) {
    assert.deepEqual(normalizeReaderSettings(value), preferences.DEFAULT_READER_SETTINGS);
  }
  const bounded = normalizeReaderSettings({ fontSizeStep: 99, wpm: -1 });
  assert.equal(bounded.fontSizeStep, 8); assert.equal(bounded.wpm, 60);
  assert.equal(normalizeReaderSettings({ fontSizeStep: 2.7, wpm: 999 }).fontSizeStep, 3);
  assert.equal(normalizeReaderSettings({ wpm: 999 }).wpm, 600);
  assert.equal(normalizeReaderSettings({ displayReadingPace: false }).displayReadingPace, false);
});
