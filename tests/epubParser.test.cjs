const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const JSZip = require('jszip');

// Exercise the real parser with real ZIP/XML/HTML dependencies. Only native
// filesystem access is replaced; these tests do not verify device storage.
const source = fs.readFileSync(path.join(__dirname, '../src/lib/epubParser.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

const importHelpers = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/bookImport.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: importHelpers, Error });

async function fixture(body, { missingFile = false, missingReference = false, emptySpine = false } = {}) {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="EPUB/content.opf"/></rootfiles></container>');
  zip.file('EPUB/content.opf', `<package><metadata><title>Test book</title><creator>Test author</creator></metadata><manifest><item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine>${emptySpine ? '' : `<itemref idref="${missingReference ? 'absent' : 'chapter'}"/>`}</spine></package>`);
  if (!missingFile) zip.file('EPUB/text/chapter.xhtml', `<html><head><title>Chapter</title></head><body>${body}</body></html>`);
  return zip.generateAsync({ type: 'uint8array' });
}

function parser(bytes, { copyFails = false, cleanupFails = false, coverWrites = null, copyWait = null, onCopyStarted = () => {} } = {}) {
  const writes = [];
  class File {
    constructor(...parts) { this.size = bytes.length; this.uri = parts.join('/'); this.exists = false; }
    create() { this.exists = true; }
    write(value) { coverWrites.push({ uri: this.uri, bytes: Array.from(value) }); }
    delete() { this.exists = false; }
    async bytes() { return bytes; }
  }
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Error,
    console,
    require(name) {
      if (name === 'expo-crypto') return { randomUUID: () => require('node:crypto').randomUUID(), CryptoDigestAlgorithm: { SHA256: 'sha256' }, digest: async (_, value) => Uint8Array.from(require('node:crypto').createHash('sha256').update(value).digest()).buffer };
      if (name === './epubStructure' || name === './epubAssets' || name === './bookPages') return require('./loadTypeScript.cjs').loadTypeScript(path.resolve(__dirname, '../src/lib', name + '.ts'));
      if (name === './bookImport') return importHelpers;
      if (name === 'expo-file-system') return { File };
      if (name === './localStore') return {
        coversDir() { writes.push('cover'); if (coverWrites) return 'file:///covers'; throw new Error('Unexpected cover access'); },
        persistBookFile() {
          writes.push('epub'); onCopyStarted();
          if (copyFails) throw new importHelpers.ImportStorageError('Could not save the EPUB file. Check available storage.');
          return copyWait ? copyWait.then(() => 'file:///saved.epub') : 'file:///saved.epub';
        },
        removeBookFiles() {
          writes.push('cleanup');
          if (cleanupFails === 'throw') throw new Error('Cleanup unavailable');
          return !cleanupFails;
        },
      };
      return require(name);
    },
  }, { filename: 'epubParser.js' });
  return { parse: () => exports.parseEpubFile('file:///input.epub', 'input.epub'), writes };
}

function paragraphs(result) {
  return Array.from(result.pages).flatMap(p => [
    p.dropCap + p.paragraph1,
    p.paragraph2Lead + p.highlightedText + p.paragraph2Rest,
  ]).filter(Boolean);
}

test('retains short dialogue, closing lines, and an unpaired final paragraph', async () => {
  const input = parser(await fixture('<p>Yes.</p><p>A longer sentence survives alongside the short dialogue.</p><p>THE END.</p>'));
  const result = await input.parse();
  assert.deepEqual(paragraphs(result), ['Yes.', 'A longer sentence survives alongside the short dialogue.', 'THE END.']);
  assert.equal(result.book.totalPages, 2);
  assert.equal(result.book.progressPercent, 0);
  assert.equal(result.book.coverStyle, 'image');
  assert.equal(result.book.lastOpened, 'Not yet read');
  assert.deepEqual(input.writes, ['epub']);
});

test('imports a short poem instead of inventing fallback content', async () => {
  const result = await parser(await fixture('<p>I wait.</p><p>You go.</p>')).parse();
  assert.deepEqual(paragraphs(result), ['I wait.', 'You go.']);
});

for (const text of ['a', 'é', '📖', 'lowercase opening']) {
  test(`preserves the first character without duplication or case changes: ${text}`, async () => {
    assert.deepEqual(paragraphs(await parser(await fixture(`<p>${text}</p>`)).parse()), [text]);
  });
}

test('ignores empty paragraphs without duplicating nested blockquotes', async () => {
  const result = await parser(await fixture('<p>  </p><blockquote><p>Stay.</p><p>Go.</p></blockquote>')).parse();
  assert.deepEqual(paragraphs(result), ['Stay.', 'Go.']);
});

for (const [name, body, options, message] of [
  ['empty content', '<p> </p>', {}, /No readable text/],
  ['image-only content', '<img src="page.png"/>', {}, /No readable text/],
  ['empty spine', '<p>Text.</p>', { emptySpine: true }, /No readable text/],
  ['missing chapter reference', '<p>Text.</p>', { missingReference: true }, /missing chapter/],
  ['missing chapter file', '<p>Text.</p>', { missingFile: true }, /missing a chapter file/],
]) {
  test(`rejects ${name} without saving an imported book`, async () => {
    const input = parser(await fixture(body, options));
    await assert.rejects(input.parse, message);
    assert.deepEqual(input.writes, []);
  });
}

test('rejects a ZIP without EPUB container metadata', async () => {
  const input = parser(await new JSZip().generateAsync({ type: 'uint8array' }));
  await assert.rejects(input.parse, /container.xml not found/);
  assert.deepEqual(input.writes, []);
});

// Plain-text fidelity: each source block should appear once, in document order.
for (const [name, body, expected] of [
  ['lists with nested paragraphs', '<ul><li>First item</li><li><p>Second item</p><ul><li>Nested item</li></ul></li></ul>', ['First item', 'Second item', 'Nested item']],
  ['mixed blockquote content', '<blockquote>Before.<p>Inside.</p>After.</blockquote>', ['Before.', 'Inside.', 'After.']],
  ['nested paragraph wrappers', '<div class="paragraph">Before.<p>Inside.</p>After.</div>', ['Before.', 'Inside.', 'After.']],
  ['direct body and section text', 'Opening.<section>Start.<div>Middle.</div>End.</section>Closing.', ['Opening.', 'Start.', 'Middle.', 'End.', 'Closing.']],
  ['table text', '<table><caption>Distances</caption><tr><th>Place</th><th>Miles</th></tr><tr><td>Home</td><td>12</td></tr></table>', ['Distances\nPlace | Miles\nHome | 12']],
  ['headings and captions', '<h1>Opening</h1><p>Text.</p><h2>Second part</h2><figure><figcaption>The river</figcaption></figure>', ['Opening', 'Text.', 'Second part', 'The river']],
  ['line breaks', '<p>First line<br/>Second line<br/>Last line</p>', ['First line', 'Second line', 'Last line']],
  ['entities and inline words', '<p>Fish &amp; chips with <em>salt</em> and <strong>pepper</strong>.</p>', ['Fish & chips with salt and pepper.']],
  ['non-reading markup', '<script>Secret script</script><style>.red {color:red}</style><!-- ignore --><p>Visible.</p>', ['Visible.']],
  ['definition lists', '<dl><dt>Folio</dt><dd>A leaf of a book.</dd></dl>', ['Folio', 'A leaf of a book.']],
]) {
  test(`preserves ${name} in order without duplicate blocks`, async () => {
    assert.deepEqual(paragraphs(await parser(await fixture(body)).parse()), expected);
  });
}

test('uses the visible chapter heading instead of the XHTML window title', async () => {
  const result = await parser(await fixture('<h1>Visible chapter</h1><p>Text.</p>')).parse();
  assert.equal(result.pages[0].chapterTitle, 'VISIBLE CHAPTER');
});

test('the phone-test EPUB retains its entire expected text sequence', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../docs/fixtures/folio-content-check.epub'));
  const result = await parser(bytes).parse();
  assert.equal(result.book.title, 'Folio Content Check');
  assert.equal(result.pages[0].chapterTitle, 'CONTENT CHECK');
  assert.deepEqual(paragraphs(result), [
    'Content Check', 'Yes.', 'Before the wrapper.', 'Before the nested paragraph.',
    'Inside the nested paragraph.', 'After the nested paragraph.', 'After the wrapper.',
    'List Check', 'First list item.', 'Second list item.', 'Nested list item.',
    'Before the quotation.', 'Inside the quotation.', 'After the quotation.',
    'Table Check', 'Journey distances\nPlace | Miles\nHome | 12',
    'First short line.', 'Second short line.', 'Fish & chips with salt and pepper.', 'THE END.',
  ]);
});


test('numbered resume-check EPUB retains all eight long paragraphs and both chapters', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../docs/fixtures/folio-resume-check.epub'));
  const result = await parser(bytes).parse();
  const text = paragraphs(result);
  assert.equal(result.book.title, 'Folio Resume Check');
  assert.equal(text.length, 10);
  const numbered = text.filter(paragraph => paragraph.includes('This numbered sentence'));
  assert.equal(numbered.length, 8);
  for (const [index, name] of ['Amber', 'Brook', 'Cedar', 'Dawn', 'Ember', 'Fern', 'Grove', 'Harbor'].entries()) {
    assert.ok(numbered[index].startsWith(`${name}-001.`));
    assert.ok(numbered[index].includes(`${name}-080.`));
    assert.equal((numbered[index].match(/numbered sentence/g) || []).length, 80);
  }
  assert.equal(new Set(result.pages.map(p => p.chapterNumber)).size, 2);
});

test('EPUB copy failure rejects parsing and attempts rollback', async () => {
  const input = parser(await fixture('<p>Readable text.</p>'), { copyFails: true });
  await assert.rejects(input.parse, /Could not save the EPUB file/);
  assert.deepEqual(input.writes, ['epub', 'cleanup']);
});

test('EPUB copy failure reports incomplete cleanup instead of claiming success', async () => {
  const input = parser(await fixture('<p>Readable text.</p>'), { copyFails: true, cleanupFails: true });
  await assert.rejects(input.parse, /Some incomplete import files could not be removed/);
  assert.deepEqual(input.writes, ['epub', 'cleanup']);
});


test('unexpected cleanup errors do not mask the original EPUB copy failure', async () => {
  const input = parser(await fixture('<p>Readable text.</p>'), { copyFails: true, cleanupFails: 'throw' });
  await assert.rejects(input.parse, /Could not save the EPUB file.*Some incomplete import files could not be removed/);
});


test('EPUB 3 SVG cover wrappers save embedded raster artwork instead of an unsupported SVG thumbnail', async () => {
  const zip = await JSZip.loadAsync(await fixture('<p>A story.</p>'));
  zip.file('EPUB/content.opf', '<package><metadata><title>Illustrated book</title></metadata><manifest><item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  zip.file('EPUB/images/cover.svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="art.jpg"/></svg>');
  zip.file('EPUB/images/art.jpg', Uint8Array.from([255, 216, 255, 224, 10, 20, 30, 40]));
  const coverWrites = [], input = parser(await zip.generateAsync({ type: 'uint8array' }), { coverWrites });
  const result = await input.parse();
  assert.equal(coverWrites.length, 1); assert.match(coverWrites[0].uri, /\.jpg$/);
  assert.deepEqual(coverWrites[0].bytes, [255, 216, 255, 224, 10, 20, 30, 40]);
  assert.equal(result.book.coverUrl, coverWrites[0].uri); assert.equal(result.book.coverStyle, 'image');
});

test('new imports fingerprint the actual EPUB bytes and preserve unique source text-node paths', async () => {
  const bytes = await fixture('<h1>First</h1><p><em>One</em> two three.</p><p>Four<br/>Five.</p>');
  const first = await parser(bytes).parse(), again = await parser(bytes).parse();
  const expected = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  assert.equal(first.book.documentFingerprint, expected); assert.equal(again.book.documentFingerprint, expected);
  const paths = first.pages.flatMap(page => Array.from(page.source.paths));
  assert.equal(new Set(paths).size, paths.length); assert.equal(paths.length, 4);
  for (const page of first.pages) { assert.equal(page.source.edition, expected); assert.equal(page.source.href, 'EPUB/text/chapter.xhtml'); assert.equal(page.source.version, 1); }
  assert.deepEqual(Array.from(again.pages, page => Array.from(page.source.paths)), Array.from(first.pages, page => Array.from(page.source.paths)));
  const changed = await parser(await fixture('<h1>First</h1><p>Different text.</p>')).parse();
  assert.notEqual(changed.book.documentFingerprint, expected);
});

test('native journey fixture imports all illustrated passages and its working fragment target without fabricated text',async()=>{
  const input=parser(new Uint8Array(fs.readFileSync(path.resolve(__dirname,'../docs/fixtures/folio-device-journey.epub'))));
  const result=await input.parse(), blocks=Array.from(result.pages).flatMap(page=>Array.from(page.rich??[]));
  assert.equal(blocks.filter(block=>/^Passage \d+\./.test(block.text)).length,40);
  assert.ok(blocks.some(block=>block.kind==='image'&&block.image.svg.includes('circle')));
  assert.ok(blocks.some(block=>block.targets.includes('note')));
  assert.ok(blocks.flatMap(block=>block.runs).some(run=>run.href==='EPUB/body.xhtml#note'));
  assert.ok(blocks.some(block=>block.text==='Yes.'));assert.ok(blocks.some(block=>block.text==='THE END.'));
});

test('EPUB preparation does not return an unresolved original-file copy as a completed import',async()=>{
 let release,started;const copyWait=new Promise(done=>release=done),copyStarted=new Promise(done=>started=done),input=parser(await fixture('<p>Keep the original.</p>'),{copyWait,onCopyStarted:started});
 let completed=false;const preparing=input.parse().then(result=>{completed=true;return result;});
 await copyStarted;
 assert.ok(input.writes.includes('epub'));assert.equal(completed,false);release();assert.equal((await preparing).book.fileLocation,'file:///saved.epub');
});

test('EPUB ZIP import preserves inline-styled poetry and excludes hidden source material', async () => {
 const result = await parser(await fixture('<p style="white-space:pre-wrap">First line\nSecond line\n\nFinal stanza</p><p>Visible text.<span hidden>Hidden material.</span></p>')).parse();
 assert.deepEqual(paragraphs(result), ['First line\nSecond line\n\nFinal stanza', 'Visible text.']);
 assert.equal(result.pages[0].rich[0].text, 'First line\nSecond line\n\nFinal stanza');
 assert.equal(result.pages[0].rich[0].kind, 'paragraph');
});
