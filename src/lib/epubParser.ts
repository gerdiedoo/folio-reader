import { File } from 'expo-file-system';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { HTMLElement as HtmlNode, parse as parseHtml } from 'node-html-parser';
import { Book, BookContentPage } from '../types';
import { coversDir, persistBookFile } from './localStore';

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

  // 3. Cover (saved to permanent storage; blob: URLs don't exist on native)
  let coverUrl = '';
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
        if (!dest.exists) dest.create();
        dest.write(coverBytes);
        coverUrl = dest.uri;
      }
    }
  } catch (err) {
    console.warn('EPUB cover extraction failed:', err);
  }

  // 4. Spine → chapters
  const rawChapters: { title: string; textParagraphs: string[] }[] = [];

  for (const itemref of asArray<any>(opf.spine?.itemref)) {
    const idref = itemref['@_idref'];
    if (!idref || !manifestMap[idref]) continue;

    const href = manifestMap[idref].href;
    const chapterZip = zip.file(resolvePath(basePath, href)) || zip.file(href);
    if (!chapterZip) continue;

    const chapterHtml = await chapterZip.async('string');
    const root = parseHtml(chapterHtml);

    const heading =
      cleanText(root.querySelector('h1, h2, h3, title')?.text) ||
      `Chapter ${rawChapters.length + 1}`;

    const paragraphs: string[] = [];
    root.querySelectorAll('p, blockquote, div.paragraph').forEach((node: HtmlNode) => {
      // a <blockquote> wrapping <p>s would otherwise be emitted twice
      if (node.tagName === 'BLOCKQUOTE' && node.querySelector('p')) return;
      const text = cleanText(node.text);
      if (text.length > 20) paragraphs.push(text);
    });

    if (paragraphs.length > 0) {
      rawChapters.push({ title: heading, textParagraphs: paragraphs });
    }
  }

  // 5. Chapters → Folio reading pages (two paragraphs per page)
  const pages: BookContentPage[] = [];

  if (rawChapters.length === 0) {
    pages.push({
      chapterTitle: title.toUpperCase(),
      chapterNumber: 'CHAPTER I',
      folioNumber: 'Folio 1',
      dropCap: title.charAt(0) || 'T',
      paragraph1:
        'his book has been successfully loaded into your Folio private archive from a local EPUB file.',
      paragraph2Lead: 'You can read, highlight, annotate passages, and track your progress. ',
      highlightedText: 'Every volume retained the impression of its creator.',
      paragraph2Rest: ' Enjoy your distraction-free reading experience.',
      pageNumber: 1,
      totalBookPages: 1,
      locNumber: 1,
      totalLoc: 100,
      minutesLeftInChapter: 5,
    });
  } else {
    let globalPageNum = 1;
    let loc = 100;

    rawChapters.forEach((ch, chIdx) => {
      for (let pIdx = 0; pIdx < ch.textParagraphs.length; pIdx += 2) {
        const p1 = ch.textParagraphs[pIdx] || '';
        const p2 = ch.textParagraphs[pIdx + 1] ?? ''; // (the web version duplicated p1 here)

        const dropCap = p1.charAt(0).toUpperCase();
        const p1Rest = p1.substring(1);

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
          dropCap: dropCap || 'A',
          paragraph1: p1Rest || p1,
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
  }

  const fileLocation = persistBookFile(fileUri, bookId);
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
