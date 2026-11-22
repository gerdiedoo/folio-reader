const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/bookDescription.ts');
const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { parseBookDescription } = loaded.exports;
const text = paragraphs => paragraphs.map(p => p.runs.map(r => r.text).join(''));

test('stored EPUB descriptions preserve paragraphs, author link text, emphasis and entities without literal markup', () => {
  const result = parseBookDescription('<p><a href="https://standardebooks.org/ebooks/mary-shelley">Mary Shelley</a> wrote <i>Frankenstein</i> &amp; other stories.</p><p>A <strong>second</strong> paragraph.</p>');
  assert.deepEqual(text(result), ['Mary Shelley wrote Frankenstein & other stories.', 'A second paragraph.']);
  assert.ok(result[0].runs.some(r => r.text === 'Frankenstein' && r.emphasis));
  assert.ok(result[1].runs.some(r => r.text === 'second' && r.strong));
});

test('plain and escaped descriptions keep line breaks, Unicode and literal comparisons', () => {
  assert.deepEqual(text(parseBookDescription('First paragraph.\n\nSecond paragraph: 2 < 3 & 4 > 1.')), ['First paragraph.', 'Second paragraph: 2 < 3 & 4 > 1.']);
  assert.deepEqual(text(parseBookDescription('&lt;p&gt;Mary’s &lt;i&gt;book&lt;/i&gt;.&lt;/p&gt;')), ['Mary’s book.']);
  assert.deepEqual(text(parseBookDescription('<p>One<br>Two</p>')), ['One\nTwo']);
});

test('description rendering drops scripts, styles, hidden text and embedded content while retaining visible prose', () => {
  const result = parseBookDescription('<script>danger()</script><style>.hidden{}</style><p hidden>Secret</p><p>Visible <a href="javascript:danger()">words</a>.</p><iframe>Not prose</iframe>');
  assert.deepEqual(text(result), ['Visible words.']);
  assert.deepEqual(parseBookDescription('<p> </p><script>danger()</script>'), []);
  assert.deepEqual(parseBookDescription(undefined), []);
});

test('headings and list items become separate readable blocks', () => {
  const result = parseBookDescription('<h2>About</h2><ul><li>First item</li><li>Second <em>item</em></li></ul>');
  assert.deepEqual(text(result), ['About', '• First item', '• Second item']);
  assert.equal(result[0].heading, true);
  assert.deepEqual(text(parseBookDescription('<ol><li><p>First</p></li><li>Second</li></ol>')), ['1. First', '2. Second']);
});
