import JSZip from 'jszip';
import type { HTMLElement } from 'node-html-parser';
import { parse } from 'node-html-parser';
import { epubPath, staticEpubSvg } from './epubStructure';
import type { RichBlock } from '../types';

const MAX_EXPANDED = 128 * 1024 * 1024, MAX_IMAGE = 6 * 1024 * 1024;
interface Stream {
  on(event: 'data', callback: (data: Uint8Array) => void): Stream;
  on(event: 'error', callback: (error: Error) => void): Stream;
  on(event: 'end', callback: () => void): Stream;
  pause(): Stream; resume(): Stream;
}
const decodeText = async (bytes: Uint8Array) => new JSZip().file('text', bytes).file('text')!.async('string');
function dimensions(bytes: Uint8Array, mime: string): { width?: number; height?: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png' && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (mime === 'image/gif' && bytes.length >= 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (mime === 'image/jpeg') {
    let at = 2;
    while (at + 8 < bytes.length) {
      if (bytes[at] !== 255) break;
      const marker = bytes[at + 1]; if (marker === 217 || marker === 218) break;
      if (marker >= 192 && marker <= 207 && ![196,200,204].includes(marker)) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      const size = view.getUint16(at + 2); if (size < 2) break; at += size + 2;
    }
  }
  return {};
}
function svgDimensions(element: HTMLElement): { width?: number; height?: number } {
  const box = (element.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
  const plain = (key: string) => { const value = element.getAttribute(key) || ''; return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : undefined; };
  const width = plain('width') ?? (box.length === 4 ? box[2] : undefined), height = plain('height') ?? (box.length === 4 ? box[3] : undefined);
  return width && height && width > 0 && height > 0 && Number.isFinite(width / height) ? { width, height } : {};
}
function rasterMime(bytes: Uint8Array): string {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) return 'image/gif';
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'image/webp';
  throw Error('This EPUB uses an illustration format Folio cannot display faithfully yet.');
}
export function createEpubAssets(zip: JSZip) {
  const files = Object.values(zip.files);
  if (files.length > 15000) throw Error('This EPUB contains too many files to prepare safely.');
  let declared = 0, expanded = 0, artwork = 0, placements = 0;
  for (const file of files) {
    const detail = file as JSZip.JSZipObject & { unsafeOriginalName?: string; _data?: { uncompressedSize?: number } };
    const name = detail.unsafeOriginalName ?? file.name;
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw Error('This EPUB contains unsafe archive paths.');
    const size = detail._data?.uncompressedSize;
    if (!file.dir && (typeof size !== 'number' || size < 0)) throw Error('This EPUB archive could not be inspected safely.');
    declared += size ?? 0;
    if (declared > MAX_EXPANDED) throw Error('This EPUB expands beyond the supported 128 MB limit.');
  }
  const readBytes = async (path: string, limit = 8 * 1024 * 1024): Promise<Uint8Array | undefined> => {
    const file = zip.file(path); if (!file) return;
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = []; let length = 0, stopped = false;
      const stream = (file as JSZip.JSZipObject & { internalStream(type: string): Stream }).internalStream('uint8array');
      stream.on('data', chunk => {
        if (stopped) return;
        length += chunk.length; expanded += chunk.length;
        if (length > limit || expanded > MAX_EXPANDED) { stopped = true; stream.pause(); reject(Error('This EPUB contains content too large to prepare safely.')); return; }
        chunks.push(chunk);
      }).on('error', reject).on('end', () => {
        if (stopped) return;
        const value = new Uint8Array(length); let at = 0;
        for (const chunk of chunks) { value.set(chunk, at); at += chunk.length; }
        resolve(value);
      }).resume();
    });
  };
  const readText = async (path: string) => { const value = await readBytes(path); return value ? decodeText(value) : undefined; };
  const images = new Map<string, Promise<NonNullable<RichBlock['image']>>>();
  const image = async (element: HTMLElement, chapter: string, seen = new Set<string>()): Promise<NonNullable<RichBlock['image']>> => {
    const alt = element.getAttribute('alt') || element.getAttribute('aria-label') || element.querySelector('title')?.text || '';
    let src = element.getAttribute('src') || '';
    if (element.rawTagName?.toLowerCase() === 'svg') {
      const embedded = element.querySelector('image');
      if (!embedded) {
        const svg = staticEpubSvg(element.toString()); placements += svg.length;
        if (placements > 32 * 1024 * 1024) throw Error('This EPUB repeats more artwork than the reader can prepare safely.');
        return { svg, alt, ...svgDimensions(element) };
      }
      if (element.querySelectorAll('image').length !== 1 || element.querySelector('path,rect,circle,text')) throw Error('This EPUB uses an unsupported mixed SVG illustration.');
      src = embedded.getAttribute('href') || embedded.getAttribute('xlink:href') || '';
    }
    if (!src || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(src)) throw Error('No readable text or complete illustration could be prepared: this EPUB uses missing or remote artwork. Choose an edition with embedded images.');
    const path = epubPath(chapter.slice(0, chapter.lastIndexOf('/') + 1), src);
    if (seen.has(path) || seen.size >= 8) throw Error('This EPUB contains circular illustration references.');
    let pending = images.get(path);
    if (!pending) {
      pending = (async () => {
        if (/\.svg$/i.test(path)) {
          const text = await readText(path); if (!text) throw Error('This EPUB is missing an illustration.');
          const svg = parse(text).querySelector('svg'); if (!svg) throw Error('This EPUB contains an invalid SVG illustration.');
          const embedded = svg.querySelector('image');
          if (embedded) return image(svg, path, new Set([...seen, path]));
          artwork += text.length; if (artwork > 24 * 1024 * 1024) throw Error('This EPUB contains more artwork than the current reader can prepare safely.');
          return { svg: staticEpubSvg(text), alt: '', ...svgDimensions(svg) };
        }
        const bytes = await readBytes(path, MAX_IMAGE); if (!bytes?.length) throw Error('No readable text or complete illustration could be prepared: this EPUB is missing an illustration.');
        artwork += bytes.length; if (artwork > 24 * 1024 * 1024) throw Error('This EPUB contains more artwork than the current reader can prepare safely.');
        const mime = rasterMime(bytes), size = dimensions(bytes, mime);
        if (size.width && size.height && (size.width * size.height > 24000000 || size.width > 20000 || size.height > 20000)) throw Error('This EPUB illustration is too large to display safely.');
        const base64 = await new JSZip().file('image', bytes).file('image')!.async('base64');
        return { uri: `data:${mime};base64,${base64}`, alt: '', ...size };
      })();
      images.set(path, pending);
    }
    const asset = await pending;
    placements += asset.uri?.length ?? asset.svg?.length ?? 0;
    if (placements > 32 * 1024 * 1024) throw Error('This EPUB repeats more artwork than the reader can prepare safely.');
    return { ...asset, alt };
  };
  return { readBytes, readText, image };
}
