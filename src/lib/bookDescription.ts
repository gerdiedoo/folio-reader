import { HTMLElement, Node, NodeType, parse } from 'node-html-parser';

export interface DescriptionRun { text: string; emphasis?: boolean; strong?: boolean }
export interface DescriptionParagraph { runs: DescriptionRun[]; heading?: boolean }
const blocks = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE']);
const hidden = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG']);
const formattingTag = /<\/?(?:p|div|br|i|em|b|strong|a|ul|ol|li|blockquote|h[1-6])(?:\s|>|\/)/i;

/** Native display model only: never executes HTML or loads remote assets. */
export function parseBookDescription(value?: string): DescriptionParagraph[] {
  if (!value?.trim()) return [];
  let source = value;
  // Some catalogs escape an entire HTML fragment rather than only its text.
  if (!formattingTag.test(source) && /&lt;/i.test(source)) {
    const decoded = parse(source).text;
    if (formattingTag.test(decoded)) source = decoded;
  }
  const root = parse(source), paragraphs: DescriptionParagraph[] = [];
  let runs: DescriptionRun[] = [];
  let heading = false;
  let marker = '';
  const flush = () => {
    if (runs.length) {
      runs[0].text = runs[0].text.trimStart();
      runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
      if (runs.some(run => run.text.trim())) {
        runs = runs.filter(run => run.text);
        runs[0].text = marker + runs[0].text; marker = '';
        paragraphs.push({ runs, ...(heading ? { heading: true } : {}) });
      }
    }
    runs = []; heading = false;
  };
  const append = (text: string, style: Omit<DescriptionRun, 'text'>) => {
    text = text.replace(/\s+/g, ' ');
    if (!text) return;
    const previous = runs[runs.length - 1];
    if (previous?.text.endsWith(' ')) text = text.trimStart();
    if (!text) return;
    if (previous && previous.emphasis === style.emphasis && previous.strong === style.strong) previous.text += text;
    else runs.push({ text, ...style });
  };
  const visit = (node: Node, inherited: Omit<DescriptionRun, 'text'> = {}, list?: { next: number }) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      // Plain descriptions often use blank lines rather than HTML paragraphs.
      node.text.split(/\n\s*\n/).forEach((text, index) => { if (index) flush(); append(text, inherited); });
      return;
    }
    const element = node as HTMLElement, tag = element.rawTagName?.toUpperCase() ?? '';
    if (hidden.has(tag) || element.hasAttribute?.('hidden') || element.getAttribute?.('aria-hidden') === 'true') return;
    if (tag === 'BR') { append('\n', inherited); if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd() + '\n'; return; }
    const block = blocks.has(tag);
    if (block) flush();
    if (/^H[1-6]$/.test(tag)) heading = true;
    if (tag === 'LI') marker = list?.next ? `${list.next++}. ` : '• ';
    const style = { ...inherited, ...(['I', 'EM', 'CITE'].includes(tag) ? { emphasis: true } : {}), ...(['B', 'STRONG'].includes(tag) ? { strong: true } : {}) };
    if (tag === 'IMG') append(element.getAttribute('alt') || '', style);
    else {
      const childList = tag === 'OL' ? { next: 1 } : tag === 'UL' ? { next: 0 } : list;
      node.childNodes.forEach(child => visit(child, style, childList));
    }
    if (block) flush();
    if (tag === 'LI') marker = '';
  };
  visit(root); flush();
  return paragraphs;
}
