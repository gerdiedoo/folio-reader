import { HTMLElement, Node, NodeType, parse } from 'node-html-parser';
import type { InlineRun, RichBlock } from '../types';

const BLOCKS = new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','CAPTION','DD','DIV','DL','DT','FIGCAPTION','FIGURE','FOOTER','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','NAV','OL','P','PRE','SECTION','TABLE','TBODY','TD','TFOOT','TH','THEAD','TR','UL']);
const SKIP = new Set(['HEAD','SCRIPT','STYLE','TEMPLATE','NOSCRIPT']);
const UNSUPPORTED = new Set(['MATH','AUDIO','VIDEO','IFRAME','OBJECT','EMBED','CANVAS']);
const tagOf = (node: Node) => (node as HTMLElement).rawTagName?.toUpperCase().split(':').pop() ?? '';
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
export function epubPath(base: string, href: string): string {
  const result: string[] = [];
  for (const part of (base + decode(href).split('#')[0]).split('/')) {
    if (part === '..') { if (!result.length) throw Error('This EPUB references a file outside its archive.'); result.pop(); }
    else if (part && part !== '.') result.push(part);
  }
  return result.join('/');
}
export function epubLink(chapter: string, href: string): string | undefined {
  if (/^https?:\/\//i.test(href)) { try { const u = new URL(href); return !u.username && !u.password ? u.href : undefined; } catch { return; } }
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(href)) return;
  const [path, fragment] = href.split('#');
  try { return (path ? epubPath(chapter.slice(0, chapter.lastIndexOf('/') + 1), path) : chapter) + (fragment !== undefined ? '#' + decode(fragment) : ''); } catch { return; }
}
type Flags = Omit<InlineRun, 'text'>;
function flags(node: HTMLElement, inherited: Flags, chapter: string): Flags {
  const tag = tagOf(node), result = { ...inherited };
  if (['B','STRONG'].includes(tag)) result.strong = true;
  if (['I','EM','CITE'].includes(tag)) result.emphasis = true;
  if (['CODE','KBD','SAMP'].includes(tag)) result.code = true;
  if (['S','STRIKE','DEL'].includes(tag)) result.strike = true;
  if (['U','INS'].includes(tag)) result.underline = true;
  if (tag === 'DT') result.strong = true;
  if (tag === 'SUP') result.superscript = true;
  if (tag === 'SUB') result.subscript = true;
  if (tag === 'A') result.href = epubLink(chapter, node.getAttribute('href') ?? '');
  return result;
}
function normalize(parts: InlineRun[], pre: boolean): InlineRun[] {
  const runs: InlineRun[] = [];
  const append = (text: string, style: Flags) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && JSON.stringify({ ...last, text: '' }) === JSON.stringify({ ...style, text: '' })) last.text += text;
    else runs.push({ ...style, text });
  };
  let space = false;
  for (const { text, ...style } of parts) {
    if (pre) { append(text.replace(/\r\n?/g, '\n'), style); continue; }
    for (const chunk of text.match(/\s+|\S+/gu) ?? []) {
      if (/^\s/u.test(chunk)) { space = runs.length > 0; continue; }
      if (space) append(' ', {});
      append(chunk, style); space = false;
    }
  }
  return runs;
}
function textRuns(root: HTMLElement, chapter: string): InlineRun[] {
  const parts: InlineRun[] = [];
  const visit = (node: Node, style: Flags) => {
    if (node.nodeType === NodeType.TEXT_NODE) { parts.push({ ...style, text: node.text }); return; }
    if (node.nodeType !== NodeType.ELEMENT_NODE || SKIP.has(tagOf(node))) return;
    if (tagOf(node) === 'BR') parts.push({ text: ' ' });
    else node.childNodes.forEach(child => visit(child, flags(node as HTMLElement, style, chapter)));
  };
  visit(root, {}); return normalize(parts, false);
}
function firstTextPath(node: Node, path: string): string {
  if (SKIP.has(tagOf(node))) return '';
  if (node.nodeType === NodeType.TEXT_NODE && clean(node.text)) return path;
  for (const [index, child] of node.childNodes.entries()) { const found = firstTextPath(child, `${path}/${index}`); if (found) return found; }
  return '';
}
export interface StructuredBlock { text: string; path: string; rich: RichBlock }
interface Context { kind: RichBlock['kind']; level?: number; marker?: string; quoteDepth?: number; pre?: boolean }
export async function extractEpubStructure(body: HTMLElement, chapter: string, image: (node: HTMLElement) => Promise<NonNullable<RichBlock['image']>>): Promise<StructuredBlock[]> {
  const result: StructuredBlock[] = [];
  let parts: InlineRun[] = [], firstPath = '', context: Context = { kind: 'paragraph' }, targets = new Set<string>();
  const push = (block: StructuredBlock) => { if (result.length >= 50000 || block.text.length > 1000000) throw Error('This EPUB contains a chapter too large to prepare safely.'); result.push(block); };
  const flush = () => {
    const runs = normalize(parts, Boolean(context.pre)), text = runs.map(run => run.text).join('');
    if (text.trim()) push({ text, path: firstPath, rich: { version: 1, kind: context.kind, text, runs, targets: [...targets],
      ...(context.level ? { level: context.level } : {}), ...(context.marker ? { marker: context.marker } : {}), ...(context.quoteDepth ? { quoteDepth: context.quoteDepth } : {}) } });
    parts = []; firstPath = ''; targets = new Set();
  };
  const visit = async (node: Node, path: string, inherited: Context, style: Flags, ids: string[]) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      if (!firstPath && clean(node.text)) { firstPath = path; context = inherited; }
      parts.push({ ...style, text: node.text }); ids.forEach(id => targets.add(id)); return;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    const element = node as HTMLElement, tag = tagOf(node);
    if (SKIP.has(tag)) return;
    if (UNSUPPORTED.has(tag)) throw Error(`This EPUB uses ${tag.toLowerCase()} content that Folio cannot display faithfully yet. Choose another edition; the original file is unchanged.`);
    const id = element.getAttribute('id') || element.getAttribute('xml:id');
    const nextIds = id ? [...ids, id] : ids;
    if (tag === 'IMG' || tag === 'SVG') {
      flush(); const asset = await image(element), text = asset.alt || '[Illustration]';
      push({ text, path, rich: { version: 1, kind: 'image', text, runs: [{ text }], targets: nextIds, image: asset } }); return;
    }
    if (tag === 'TABLE') {
      flush();
      if (element.querySelectorAll('table, img, svg, math, audio, video, iframe, object, embed, canvas').length) throw Error('This EPUB uses nested tables or illustrated table cells that Folio cannot display faithfully yet.');
      const rows = element.querySelectorAll('tr').map(row => row.childNodes.filter(n => ['TD','TH'].includes(tagOf(n))).map(cell => {
        const e = cell as HTMLElement;
        if (Number(e.getAttribute('colspan') ?? '1') !== 1 || Number(e.getAttribute('rowspan') ?? '1') !== 1) throw Error('This EPUB uses merged table cells that Folio cannot display faithfully yet.');
        const runs = textRuns(e, chapter); return { text: runs.map(run => run.text).join(''), runs, header: tagOf(e) === 'TH' };
      })).filter(row => row.length);
      if (rows.length > 200 || rows.some(row => row.length > 16) || rows.reduce((sum, row) => sum + row.length, 0) > 1000) throw Error('This EPUB contains a table too large for the current reader.');
      const caption = clean(element.querySelector('caption')?.text ?? '');
      const text = [caption, ...rows.map(row => row.map(cell => cell.text).join(' | '))].filter(Boolean).join('\n');
      if (text) push({ text, path: firstTextPath(element, path) || path, rich: { version: 1, kind: 'table', text, runs: [{ text }], targets: nextIds, table: { caption, rows } } });
      return;
    }
    if (tag === 'BR') { if (inherited.pre) parts.push({ text: '\n' }); else flush(); return; }
    const block = BLOCKS.has(tag); if (block) flush();
    let next = { ...inherited };
    if (/^H[1-6]$/.test(tag)) next = { ...next, kind: 'heading', level: Number(tag[1]) };
    else if (tag === 'PRE') next = { ...next, kind: 'code', pre: true };
    else if (tag === 'BLOCKQUOTE') next = { ...next, kind: 'quote', quoteDepth: (next.quoteDepth ?? 0) + 1 };
    else if (tag === 'FIGCAPTION' || tag === 'CAPTION') next = { ...next, kind: 'caption' };
    else if (tag === 'LI') {
      const parent = element.parentNode, ordered = parent && tagOf(parent) === 'OL';
      const explicit = element.getAttribute('value');
      let number = Number(parent?.getAttribute('start') ?? '1');
      for (const sibling of parent?.childNodes.filter(n => tagOf(n) === 'LI') ?? []) {
        const value = (sibling as HTMLElement).getAttribute('value'); if (value !== undefined) number = Number(value);
        if (sibling === element) break; number++;
      }
      if (explicit !== undefined) number = Number(explicit);
      next = { ...next, kind: 'list-item', marker: ordered ? `${Number.isSafeInteger(number) ? number : 1}.` : '•' };
    }
    const nextStyle = flags(element, style, chapter);
    for (const [index, child] of node.childNodes.entries()) await visit(child, `${path}/${index}`, next, nextStyle, nextIds);
    if (block) flush();
  };
  await visit(body, 'body', { kind: 'paragraph' }, {}, []); flush(); return result;
}

export function validRichBlock(value: unknown): value is RichBlock {
  const b = value as RichBlock;
  const text = (s: unknown) => typeof s === 'string' && s.length <= 1000000;
  const runs = (v: unknown): v is InlineRun[] => Array.isArray(v) && v.length <= 50000 && v.every(r => r && text(r.text) &&
    ['strong','emphasis','code','strike','underline','superscript','subscript'].every(key => r[key] === undefined || typeof r[key] === 'boolean') &&
    (r.href === undefined || typeof r.href === 'string' && r.href.length <= 4000 && (r.href.startsWith('http') ? epubLink('', r.href) === r.href : !/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(r.href))));
  if (!b || b.version !== 1 || !['paragraph','heading','list-item','quote','code','caption','image','table'].includes(b.kind) || !text(b.text) || !runs(b.runs) || b.runs.map(r => r.text).join('') !== b.text ||
    !Array.isArray(b.targets) || b.targets.length > 1000 || !b.targets.every(id => typeof id === 'string' && id.length <= 4000)) return false;
  if (b.level !== undefined && (!Number.isInteger(b.level) || b.level < 1 || b.level > 6)) return false;
  if (b.marker !== undefined && (typeof b.marker !== 'string' || b.marker.length > 32)) return false;
  if (b.quoteDepth !== undefined && (!Number.isInteger(b.quoteDepth) || b.quoteDepth < 0 || b.quoteDepth > 100)) return false;
  if (b.kind === 'image') {
    const i = b.image;
    if (!i || typeof i.alt !== 'string' || i.alt.length > 1000000 || Boolean(i.uri) === Boolean(i.svg)) return false;
    if (i.uri && (!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(i.uri) || i.uri.length > 9 * 1024 * 1024)) return false;
    try { if (i.svg && staticEpubSvg(i.svg) !== i.svg) return false; } catch { return false; }
    if ([i.width,i.height].some(n => n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 20000))) return false;
  }
  if (b.kind === 'table') {
    const t = b.table;
    if (!t || !text(t.caption) || !Array.isArray(t.rows) || t.rows.length > 200 || t.rows.reduce((n, row) => n + (Array.isArray(row) ? row.length : 1001), 0) > 1000 ||
      !t.rows.every(row => Array.isArray(row) && row.length > 0 && row.length <= 16 && row.every(c => c && text(c.text) && typeof c.header === 'boolean' && runs(c.runs) && c.runs.map(r => r.text).join('') === c.text))) return false;
  }
  return true;
}

/** Only static SVG drawing primitives and local paint references reach the native renderer. */
export function staticEpubSvg(source: string): string {
  if (source.length > 2000000) throw Error('This EPUB illustration is too large to display safely.');
  const root = parse(source), svg = root.querySelector('svg');
  const allowed = new Set(['SVG','G','PATH','RECT','LINE','POLYLINE','POLYGON','CIRCLE','ELLIPSE','TEXT','TSPAN','DEFS','LINEARGRADIENT','RADIALGRADIENT','STOP','CLIPPATH','MASK','TITLE','DESC']);
  if (!svg) throw Error('This EPUB contains an invalid SVG illustration.');
  let count = 0;
  const inspect = (node: Node) => {
    if (++count > 10000) throw Error('This EPUB illustration is too complex to display safely.');
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    const e = node as HTMLElement;
    if (!allowed.has(tagOf(e))) throw Error('This EPUB uses an interactive or unsupported SVG illustration.');
    for (const [key, value] of Object.entries(e.attributes)) {
      if (key === 'xmlns' && value === 'http://www.w3.org/2000/svg' || key === 'xmlns:xlink' && value === 'http://www.w3.org/1999/xlink') continue;
      if (/^on|href|src/i.test(key) || /(?:https?:|data:|javascript:|file:|@import|expression\s*\()/i.test(value) || /url\s*\(\s*[^#]/i.test(value)) throw Error('This EPUB illustration references external or active content.');
    }
    e.childNodes.forEach(inspect);
  };
  inspect(svg); return svg.toString();
}
