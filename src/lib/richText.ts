import type { InlineRun, RichBlock } from '../types';
export function sliceRuns(runs: InlineRun[], start: number, end: number): InlineRun[] {
  const result: InlineRun[] = []; let at = 0;
  for (const run of runs) {
    const from = Math.max(0, start - at), to = Math.min(run.text.length, end - at);
    if (to > from) result.push({ ...run, text: run.text.slice(from, to) });
    at += run.text.length; if (at >= end) break;
  }
  return result;
}
export function sliceRichWords(block: RichBlock | null | undefined, startWord: number, count: number): RichBlock | null {
  if (!block || !count) return null;
  const words = [...block.text.matchAll(/\S+/gu)];
  const from = words[startWord]?.index, last = words[startWord + count - 1];
  if (from === undefined || !last) return null;
  const to = last.index! + last[0].length;
  return { ...block, text: block.text.slice(from, to), runs: sliceRuns(block.runs, from, to), ...(startWord > 0 ? { marker: undefined } : {}) };
}
