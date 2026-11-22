export type ShelfColumns = 2 | 3;

export function bookShelfLayout(width: number, fontScale: number, preferred: ShelfColumns) {
  const contentWidth = Math.max(0, Math.min(Number.isFinite(width) ? width : 360, 768) - 40);
  const gap = 16;
  const capacity = Math.max(1, Math.floor((contentWidth + gap) / (80 + gap)));
  const columns = fontScale > 1.3 ? 1 : Math.min(preferred, capacity);
  return { columns, gap, cardWidth: Math.max(0, Math.floor((contentWidth - (columns - 1) * gap) / columns)) };
}
