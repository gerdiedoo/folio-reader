const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { parse } = require('node-html-parser');
const JSZip = require('jszip');
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { extractEpubStructure, staticEpubSvg, validRichBlock, epubLink } = loadTypeScript(path.resolve(__dirname, '../src/lib/epubStructure.ts'));
const { createEpubAssets } = loadTypeScript(path.resolve(__dirname, '../src/lib/epubAssets.ts'));
const { validatedBookPages } = loadTypeScript(path.resolve(__dirname, '../src/lib/bookPages.ts'));
const { paginateContent } = loadTypeScript(path.resolve(__dirname, '../src/lib/readerPagination.ts'));
const extract = async html => extractEpubStructure(parse('<body>' + html + '</body>').querySelector('body'), 'EPUB/text/chapter.xhtml', async () => { throw Error('Unexpected image'); });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
const page = rich => ({ chapterTitle: 'One', chapterNumber: '1', folioNumber: '1', pageNumber: 1, totalBookPages: 1, locNumber: 1, totalLoc: 2, minutesLeftInChapter: 1,
 dropCap: '', paragraph1: rich[0].text, paragraph2Lead: '', highlightedText: rich[1]?.text || '', paragraph2Rest: '', rich });

test('preserves emphasis, strong text, code, headings, lists, quotes, and exact preformatted whitespace', async () => {
 const blocks = await extract('<h1 id="start">Opening</h1><p>Fish &amp; <em>chips <strong>today</strong></em>.</p><ol start="0"><li>Zero</li><li value="4"><p>Four</p></li></ol><blockquote><p>Quoted.</p></blockquote><pre>  const x = 1;\n\treturn x;  </pre>');
 assert.deepEqual(blocks.map(b => b.rich.kind), ['heading','paragraph','list-item','list-item','quote','code']);
 assert.deepEqual(blocks[0].rich.targets, ['start']); assert.equal(blocks[1].text, 'Fish & chips today.');
 assert.ok(blocks[1].rich.runs.some(r => r.text === 'today' && r.strong && r.emphasis));
 assert.deepEqual(blocks.slice(2,4).map(b => b.rich.marker), ['0.','4.']);
 assert.equal(blocks[5].text, '  const x = 1;\n\treturn x;  ');
 for (const block of blocks) assert.equal(validRichBlock(block.rich), true);
});

test('represents tables as a real grid with header cells and a complete text alternative', async () => {
 const [block] = await extract('<table id="distances"><caption>Distances</caption><tr><th>Place</th><th>Miles</th></tr><tr><td><em>Home</em></td><td>12</td></tr></table>');
 assert.equal(block.rich.kind, 'table'); assert.equal(block.text, 'Distances\nPlace | Miles\nHome | 12');
 assert.equal(block.rich.table.rows[0][0].header, true); assert.equal(block.rich.table.rows[1][0].runs[0].emphasis, true);
 assert.equal(validRichBlock(block.rich), true);
});

test('links resolve chapter-relative targets without allowing executable or device URLs', async () => {
 const blocks = await extract('<p>Read <a href="../notes.xhtml#fn1">note one</a>.</p><aside id="fn1"><p>A note.</p></aside>');
 assert.equal(blocks[0].rich.runs.find(r => r.href).href, 'EPUB/notes.xhtml#fn1'); assert.ok(blocks[1].rich.targets.includes('fn1'));
 for (const href of ['javascript:alert(1)', 'file:///private', '//example.test', '../../../outside']) assert.equal(epubLink('EPUB/chapter.xhtml', href), undefined);
 assert.equal(epubLink('EPUB/chapter.xhtml', '#fn'), 'EPUB/chapter.xhtml#fn');
});

test('embedded illustrations remain offline data with alt text, dimensions and a stable block position', async () => {
 const source = new JSZip(); source.file('EPUB/images/art.png', png);
 const assets = createEpubAssets(await JSZip.loadAsync(await source.generateAsync({ type: 'uint8array' })));
 const blocks = await extractEpubStructure(parse('<body><p>Before.</p><img src="../images/art.png" alt="A diagram"/><p>After.</p></body>').querySelector('body'), 'EPUB/text/chapter.xhtml', e => assets.image(e, 'EPUB/text/chapter.xhtml'));
 assert.deepEqual(blocks.map(b => b.text), ['Before.','A diagram','After.']);
 const image = blocks[1].rich; assert.equal(image.image.width, 1); assert.equal(image.image.height, 1); assert.match(image.image.uri, /^data:image\/png;base64,/);
 assert.equal(validRichBlock(image), true); assert.equal(blocks[1].path, 'body/1');
 validatedBookPages([page([image])]);
});

test('static SVG drawing is supported; active SVG and foreign-resource references are rejected', () => {
 const svg = staticEpubSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>');
 assert.match(svg, /circle/);
 for (const body of ['<script>alert(1)</script>', '<image href="https://example.test/art.png"/>', '<foreignObject>HTML</foreignObject>', '<rect onload="evil()"/>']) assert.throws(() => staticEpubSvg('<svg>' + body + '</svg>'));
});

for (const html of ['<math><mi>x</mi></math>', '<video/>', '<table><tr><td colspan="2">Merged</td></tr></table>', '<table><tr><td><img src="x"/></td></tr></table>']) {
 test(`unsupported semantic content is rejected explicitly: ${html.slice(0, 24)}`, async () => { await assert.rejects(extract(html)); });
}

test('Pages keeps illustration/table/code blocks intact and slices styled prose without dropping words', async () => {
 const code = (await extract('<pre>  x\n  y</pre>'))[0].rich;
 assert.equal(paginateContent([page([code])], 4, 12)[0].page.rich[0].text, code.text);
 const prose = (await extract('<p>one two <em>three four five six seven eight nine ten eleven twelve</em> thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty</p>'))[0].rich;
 const pieces = paginateContent([page([prose])], 4, 12);
 assert.ok(pieces.length > 1);
 assert.equal(pieces.map(p => p.page.rich[0]?.text || '').join(' '), prose.text);
 assert.equal(pieces.flatMap(p => p.page.rich[0]?.runs || []).filter(r => r.emphasis).map(r => r.text).join(' ').replace(/\s+/g,' ').trim(), 'three four five six seven eight nine ten eleven twelve');
});

test('untrusted backup/cache content cannot inject an active image or mismatched rich text', () => {
 const base = { version: 1, kind: 'image', text: 'A picture', runs: [{ text: 'A picture' }], targets: [], image: { uri: 'https://example.test/track', alt: 'Picture' } };
 assert.throws(() => validatedBookPages([page([base])]));
 base.image = { svg: '<svg><script>evil()</script></svg>', alt: '' }; assert.throws(() => validatedBookPages([page([base])]));
 assert.throws(() => validatedBookPages([{ ...page([{ version: 1, kind: 'paragraph', text: 'Good', runs: [{ text: 'Good' }], targets: [] }]), paragraph1: 'Different text' }]));
});

test('ordered-list numbering follows explicit starts and item values for following siblings',async()=>{
 const blocks=await extract('<ol start="3"><li>Three</li><li value="8">Eight</li><li>Nine</li></ol>');
 assert.deepEqual(blocks.map(b=>b.rich.marker),['3.','8.','9.']);
});
