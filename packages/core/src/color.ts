// Brand colors are "#rrggbb". readableOn picks text that stays legible on top of one.

export function isHexColor(s: string | null | undefined): boolean {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s);
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** White or near-black, whichever has more contrast on the color (WCAG formula). */
export function readableOn(hex: string): "#ffffff" | "#18211e" {
  if (!isHexColor(hex)) return "#ffffff";
  const l = luminance(hex);
  return contrast(l, 1) >= contrast(l, luminance("#18211e")) ? "#ffffff" : "#18211e";
}
