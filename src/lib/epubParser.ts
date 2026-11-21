import { File } from 'expo-file-system';
import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { parse as parseHtml } from 'node-html-parser';
import { extractEpubStructure, type StructuredBlock } from './epubStructure';
import { validatedBookPages } from './bookPages';
import { createEpubAssets } from './epubAssets';
import { Book, BookContentPage } from '../types';
import { ImportStorageError, ImportCollisionError } from './bookImport';
import { coversDir as defaultCoversDir, persistBookFile as defaultPersistBookFile, removeBookFiles as defaultRemoveBookFiles } from './localStore';
import type { LocalStore } from './localStore';

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

export async function parseEpubFile(fileUri: string, fileName: string, storage?: Pick<LocalStore, 'coversDir' | 'persistBookFile' | 'removeBookFiles'>): Promise<ParsedEpub> {
  const { coversDir, persistBookFile, removeBookFiles } = storage ?? { coversDir: defaultCoversDir, persistBookFile: defaultPersistBookFile, removeBookFiles: defaultRemoveBookFiles };
  if (new File(fileUri).size > 64 * 1024 * 1024) throw new Error('This EPUB exceeds the supported 64 MB file limit.');
  const bytes = await new File(fileUri).bytes();
  if (bytes.length > 64 * 1024 * 1024) throw new Error('This EPUB exceeds the supported 64 MB file limit.');
  const documentFingerprint = Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const zip = await JSZip.loadAsync(bytes);
  const assets = createEpubAssets(zip);

  // 1. container.xml → root OPF
  const containerXml = await assets.readText('META-INF/container.xml');
  if (!containerXml) {
    throw new Error('Invalid EPUB file: META-INF/container.xml not found.');
  }
  const container = xml.parse(containerXml);
  const rootfile = asArray<any>(container?.container?.rootfiles?.rootfile)[0];
  const opfPath: string = rootfile?.['@_full-path'] || 'OEBPS/content.opf';

  // 2. OPF
  const opfStr = await assets.readText(opfPath);
  if (!opfStr) {
    throw new Error(`Invalid EPUB file: ${opfPath} not found.`);
  }
  const opf = xml.parse(opfStr)?.package ?? {};
  if (asArray<any>(opf.metadata?.meta).some(meta => meta['@_property'] === 'rendition:layout' && textOf(meta) === 'pre-paginated')) throw new Error('Fixed-layout EPUBs are not supported yet. Choose a reflowable edition.');
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

  const bookId = `epub-${randomUUID()}`;

  // Validate readable content before writing any imported files.
  // Spine → chapters
  const rawChapters: { title: string; href: string; textParagraphs: StructuredBlock[] }[] = [];

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

    const chapterHtml = await assets.readText(chapterZip.name);
    if (!chapterHtml) throw new Error('This EPUB is missing a chapter.');
    const root = parseHtml(chapterHtml);

    const body = root.querySelector('body') ?? root;
    const heading =
      cleanText(body.querySelector('h1, h2, h3, h4, h5, h6')?.text) ||
      cleanText(root.querySelector('title')?.text) ||
      `Chapter ${rawChapters.length + 1}`;
    const paragraphs = await extractEpubStructure(body, chapterZip.name, element => assets.image(element, chapterZip.name));

    if (paragraphs.length > 0) {
      rawChapters.push({ title: heading, href: resolvePath(basePath, href), textParagraphs: paragraphs });
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
      const p1 = ch.textParagraphs[pIdx]?.text || '';
      const p2 = ch.textParagraphs[pIdx + 1]?.text ?? '';

      const dropCap = Array.from(p1)[0] || '';
      const p1Rest = p1.slice(dropCap.length);

      pages.push({
        rich: ch.textParagraphs.slice(pIdx, pIdx + 2).map(block => block.rich),
        source: { version: 1, edition: documentFingerprint, href: ch.href, paths: ch.textParagraphs.slice(pIdx, pIdx + 2).map(block => block.path) },
        chapterTitle: ch.title.toUpperCase(),
        chapterNumber: `CHAPTER ${chIdx + 1}`,
        folioNumber: `Folio ${globalPageNum}`,
        dropCap,
        paragraph1: p1Rest,
        paragraph2Lead: '',
        highlightedText: p2,
        paragraph2Rest: '',
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

  validatedBookPages(pages);

  // Bound the exact UTF-8 cache before any permanent import files are created.
  const serialized = JSON.stringify(pages);
  let cacheBytes = 0;
  for (const char of serialized) { const cp = char.codePointAt(0)!; cacheBytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4; }
  if (cacheBytes > 48 * 1024 * 1024) throw new Error('This EPUB needs more reading storage than the current reader supports. Its import was not completed.');

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
      let coverPath = resolvePath(basePath, coverHref);
      let coverZipFile = zip.file(coverPath) || zip.file(coverHref);
      if (/\.svg$/i.test(coverHref) && coverZipFile) {
        const svg = parseHtml((await assets.readText(coverZipFile.name)) ?? '');
        const image = svg.querySelector('image');
        const href = image?.getAttribute('href') || image?.getAttribute('xlink:href') || '';
        const folder = coverPath.includes('/') ? coverPath.slice(0, coverPath.lastIndexOf('/') + 1) : '';
        if (href && !/^(?:[a-z]+:|\/)/i.test(href)) {
          coverPath = resolvePath(folder, href);
          coverZipFile = zip.file(coverPath);
          coverHref = coverPath;
        } else coverZipFile = null;
      }
      if (coverZipFile && !/\.svg$/i.test(coverHref)) {
        const coverBytes = await assets.readBytes(coverZipFile.name, 6 * 1024 * 1024);
        if (!coverBytes?.length) throw new Error('Empty cover');
        const ext = (coverHref.split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
        const dest = new File(coversDir(), `${bookId}.${ext}`);
        if (dest.exists) throw new ImportCollisionError('A saved cover already uses this identifier. Its files have been kept. Import the EPUB again.');
        partialCover = dest;
        if (!dest.exists) dest.create();
        dest.write(coverBytes);
        coverUrl = dest.uri;
      }
    }
  } catch (err) {
    if (err instanceof ImportCollisionError) throw err;
    console.warn('EPUB cover extraction failed:', err);
    if (partialCover) {
      try { if (partialCover.exists) partialCover.delete(); } catch { console.warn('Could not remove an incomplete cover.'); }
    }
  }

  let fileLocation: string;
  try {
    fileLocation = persistBookFile(fileUri, bookId);
  } catch (error) {
    if (error instanceof ImportCollisionError) throw error;
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
    coverStyle: 'image',
    progressPercent: 0,
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
    documentFingerprint,
    fileFormat: 'EPUB',
    fileSizeBytes: fileSizeBytes ?? undefined,
    fileLocation,
  };

  return { book: newBook, pages };
}
