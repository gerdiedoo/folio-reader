import { File } from 'expo-file-system';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { HTMLElement as HtmlNode, Node as HtmlTreeNode, NodeType, parse as parseHtml } from 'node-html-parser';
import { Book, BookContentPage } from '../types';
import { ImportStorageError } from './bookImport';
import { coversDir, persistBookFile, removeBookFiles } from './localStore';

export interface ParsedEpub {
  book: Book;
  pages: BookContentPage[];
}

/**
 * React Native has no DOMParser / querySelector for XML, so the OPF and
 * container files are read with fast-xml-parser and the chapter XHTML with
 * node-html-parser (which does support querySelectorAll).
 */
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
});

const asArray = <T,>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

function textOf(node: any): string {
  if (node === undefined || node === null) return '';
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === 'object') return textOf(node['#text']);
  return String(node).trim();
}

function safeDecode(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** Resolve "../Images/a.png" style hrefs relative to the OPF folder. */
function resolvePath(base: string, href: string): string {
  const parts = (base + safeDecode(href).split('#')[0]).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

function cleanText(s: string | undefined): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// Keep block boundaries without reading both a wrapper's text and its children.
// The reader still uses plain text: table cells and list items become blocks,
// not a recreation of publisher layout. Inline elements stay in the same block.
const TEXT_BLOCKS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DIV', 'DL', 'DT',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD',
  'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);
const NON_READING_ELEMENTS = new Set(['HEAD', 'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

function extractReadingBlocks(root: HtmlNode): string[] {
  const blocks: string[] = [];
  let buffer = '';
  const flush = () => {
    const text = cleanText(buffer);
    if (text) blocks.push(text);
    buffer = '';
  };
  const visit = (node: HtmlTreeNode) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      buffer += node.text;
      return;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    const tag = node.rawTagName?.toUpperCase().split(':').pop() ?? '';
    if (NON_READING_ELEMENTS.has(tag)) return;
    if (tag === 'BR') {
      flush();
      return;
    }
    const isBlock = TEXT_BLOCKS.has(tag);
    if (isBlock) flush();
    node.childNodes.forEach(visit);
    if (isBlock) flush();
  };
  visit(root);
  flush();
  return blocks;
}

export async function parseEpubFile(fileUri: string, fileName: string): Promise<ParsedEpub> {
  const bytes = await new File(fileUri).bytes();
  const zip = await JSZip.loadAsync(bytes);

  // 1. container.xml → root OPF
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) {
    throw new Error('Invalid EPUB file: META-INF/container.xml not found.');
  }
  const container = xml.parse(containerXml);
  const rootfile = asArray<any>(container?.container?.rootfiles?.rootfile)[0];
  const opfPath: string = rootfile?.['@_full-path'] || 'OEBPS/content.opf';

  // 2. OPF
  const opfStr = await zip.file(opfPath)?.async('string');
  if (!opfStr) {
    throw new Error(`Invalid EPUB file: ${opfPath} not found.`);
  }
  const opf = xml.parse(opfStr)?.package ?? {};
  const basePath = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const title = textOf(opf.metadata?.title) || fileName.replace(/\.epub$/i, '');
  const author = textOf(opf.metadata?.creator) || 'Unknown Author';
  const genres = asArray(opf.metadata?.subject).map(textOf).filter(Boolean);
  const annotation = textOf(opf.metadata?.description);
  const documentLanguage = textOf(opf.metadata?.language);
  const identifiers = asArray<any>(opf.metadata?.identifier);
  const uniqueIdentifierId = opf['@_unique-identifier'];
  const documentIdentifier = textOf(
    identifiers.find((identifier) => identifier?.['@_id'] === uniqueIdentifierId) ?? identifiers[0]
  );
  const fileSizeBytes = new File(fileUri).size;

  // Manifest & spine
  const manifestMap: Record<string, { href: string; mediaType: string; properties: string }> = {};
  asArray<any>(opf.manifest?.item).forEach((item) => {
    const id = item['@_id'];
    const href = item['@_href'];
    if (id && href) {
      manifestMap[id] = {
        href,
        mediaType: item['@_media-type'] || '',
        properties: item['@_properties'] || '',
      };
    }
  });

  const bookId = `epub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // Validate readable content before writing any imported files.
  // Spine → chapters
  const rawChapters: { title: string; textParagraphs: string[] }[] = [];

  for (const itemref of asArray<any>(opf.spine?.itemref)) {
    const idref = itemref['@_idref'];
    if (!idref || !manifestMap[idref]) {
      throw new Error('This EPUB references a missing chapter. Try another copy of the book.');
    }

    const href = manifestMap[idref].href;
    const chapterZip = zip.file(resolvePath(basePath, href)) || zip.file(href);
    if (!chapterZip) {
      throw new Error('This EPUB is missing a chapter file. Try another copy of the book.');
    }

    const chapterHtml = await chapterZip.async('string');
    const root = parseHtml(chapterHtml);

    const body = root.querySelector('body') ?? root;
    const heading =
      cleanText(body.querySelector('h1, h2, h3, h4, h5, h6')?.text) ||
      cleanText(root.querySelector('title')?.text) ||
      `Chapter ${rawChapters.length + 1}`;
    const paragraphs = extractReadingBlocks(body);

    if (paragraphs.length > 0) {
      rawChapters.push({ title: heading, textParagraphs: paragraphs });
    }
  }

  // Chapters → Folio reading pages (two paragraphs per page)
  const pages: BookContentPage[] = [];

  if (rawChapters.length === 0) {
    throw new Error(
      'No readable text was found in this EPUB. It may be image-only, protected, or unsupported. Try another EPUB file.'
    );
  }

  let globalPageNum = 1;
  let loc = 100;

  rawChapters.forEach((ch, chIdx) => {
    for (let pIdx = 0; pIdx < ch.textParagraphs.length; pIdx += 2) {
      const p1 = ch.textParagraphs[pIdx] || '';
      const p2 = ch.textParagraphs[pIdx + 1] ?? ''; // (the web version duplicated p1 here)

      const dropCap = Array.from(p1)[0] || '';
      const p1Rest = p1.slice(dropCap.length);

      let hlWords = '';
      let restWords = '';
      if (p2) {
        const words = p2.split(' ');
        const highlightCount = Math.min(12, Math.max(5, Math.floor(words.length / 3)));
        hlWords = words.slice(0, highlightCount).join(' ');
        restWords = words.slice(highlightCount).join(' ');
      }

      pages.push({
        chapterTitle: ch.title.toUpperCase(),
        chapterNumber: `CHAPTER ${chIdx + 1}`,
        folioNumber: `Folio ${globalPageNum}`,
        dropCap,
        paragraph1: p1Rest,
        paragraph2Lead: '',
        highlightedText: hlWords,
        paragraph2Rest: restWords ? ' ' + restWords : '',
        pageNumber: globalPageNum,
        totalBookPages: 0,
        locNumber: loc,
        totalLoc: 2500,
        minutesLeftInChapter: Math.max(3, Math.round((ch.textParagraphs.length - pIdx) * 1.5)),
      });

      globalPageNum++;
      loc += 120;
    }
  });

  pages.forEach((p) => {
    p.totalBookPages = pages.length;
    p.totalLoc = loc;
  });

  // Cover (saved to permanent storage; blob: URLs don't exist on native)
  let coverUrl = '';
  let partialCover: File | undefined;
  try {
    const coverMeta = asArray<any>(opf.metadata?.meta).find((m) => m['@_name'] === 'cover');
    const coverId = coverMeta?.['@_content'];
    let coverHref = coverId && manifestMap[coverId] ? manifestMap[coverId].href : '';

    if (!coverHref) {
      const items = Object.values(manifestMap).filter((i) => i.mediaType.startsWith('image/'));
      const coverItem =
        items.find((i) => i.properties.includes('cover-image')) ||
        items.find((i) => i.href.toLowerCase().includes('cover')) ||
        items.find((i) => /jpe?g|png/.test(i.mediaType));
      if (coverItem) coverHref = coverItem.href;
    }

    if (coverHref) {
      const coverZipFile = zip.file(resolvePath(basePath, coverHref)) || zip.file(coverHref);
      if (coverZipFile) {
        const coverBytes = await coverZipFile.async('uint8array');
        const ext = (coverHref.split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
        const dest = new File(coversDir(), `${bookId}.${ext}`);
        partialCover = dest;
        if (!dest.exists) dest.create();
        dest.write(coverBytes);
        coverUrl = dest.uri;
      }
    }
  } catch (err) {
    console.warn('EPUB cover extraction failed:', err);
    if (partialCover) {
      try { if (partialCover.exists) partialCover.delete(); } catch { console.warn('Could not remove an incomplete cover.'); }
    }
  }

  let fileLocation: string;
  try {
    fileLocation = persistBookFile(fileUri, bookId);
  } catch (error) {
    let cleaned = false;
    try { cleaned = removeBookFiles(bookId, coverUrl); } catch { /* Keep the storage failure as the main error. */ }
    const reason = error instanceof Error ? error.message : 'Could not save this EPUB file. Try again.';
    throw new ImportStorageError(cleaned ? reason : `${reason} Some incomplete import files could not be removed.`);
  }
  const newBook: Book = {
    id: bookId,
    title,
    author,
    coverUrl,
    coverStyle: coverUrl ? 'image' : 'typographic',
    progressPercent: 1,
    currentPage: 1,
    totalPages: pages.length,
    minutesLeft: Math.round(pages.length * 1.8),
    currentChapter: pages[0]?.chapterNumber || 'Chapter 1',
    lastOpened: 'Not yet read',
    isDownloaded: true,
    totalLoc: pages[pages.length - 1]?.totalLoc || 1000,
    currentLoc: 100,
    coverAlt: `Cover for ${title} by ${author}`,
    genres,
    annotation,
    documentLanguage,
    documentIdentifier,
    fileFormat: 'EPUB',
    fileSizeBytes: fileSizeBytes ?? undefined,
    fileLocation,
  };

  return { book: newBook, pages };
}
