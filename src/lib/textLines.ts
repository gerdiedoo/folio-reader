/** Native text lines mapped back to source word ordinals; no guessed character widths. */
export interface SourceLine { y: number; height: number; word: number }
export function sourceTextLines(text: string, lines: { text: string; y: number; height: number }[], startWord = 0): SourceLine[] {
  let cursor = 0;
  const result: SourceLine[] = [];
  for (const line of lines) {
    const needle = line.text.trim(); if (!needle) continue;
    const at = text.indexOf(needle, cursor);
    if (at < 0 || !Number.isFinite(line.y) || !Number.isFinite(line.height) || line.height <= 0) continue;
    let word = (text.slice(0, at).match(/\S+/gu) || []).length;
    if (at > 0 && /\S/u.test(text[at - 1]) && /\S/u.test(text[at])) word--;
    result.push({ y: line.y, height: line.height, word: startWord + Math.max(0, word) });
    cursor = at + needle.length;
  }
  return result;
}
export function sourceLineAt(lines: SourceLine[], y: number): SourceLine | undefined {
  return [...lines].sort((a,b) => a.y-b.y).find(line => line.y + line.height > y);
}
export function sourceLineForWord(lines: SourceLine[], word: number): SourceLine | undefined {
  return [...lines].sort((a,b) => a.word-b.word || a.y-b.y).filter(line => line.word <= word).at(-1);
}
