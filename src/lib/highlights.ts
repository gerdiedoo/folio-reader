import type { HighlightColorName } from '../types';

export const HIGHLIGHT_COLORS: { name: HighlightColorName; hex: string; label: string }[] = [
  { name: 'Amber Crayon', hex: '#F8E8A2', label: 'Amber' },
  { name: 'Terracotta Ink', hex: '#ffb59c', label: 'Terracotta' },
  { name: 'Sage Pencil', hex: '#d8ebd5', label: 'Sage' },
  { name: 'Lavender Quill', hex: '#e5dbff', label: 'Lavender' },
];

function luminance(hex: string): number {
  const linear = [1, 3, 5].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

/** Opaque backgrounds keep selection contrast independent of the surrounding theme. */
export function highlightTextStyle(hex: string) {
  const backgroundColor = /^#[0-9a-f]{6}$/i.test(hex) ? hex : HIGHLIGHT_COLORS[0].hex;
  const background = luminance(backgroundColor);
  const ink = luminance('#1c1c18');
  const inkContrast = (Math.max(background, ink) + 0.05) / (Math.min(background, ink) + 0.05);
  const color = inkContrast >= 4.5 ? '#1c1c18' : 1.05 / (background + 0.05) >= 4.5 ? '#ffffff' : '#000000';
  return { backgroundColor, color };
}
