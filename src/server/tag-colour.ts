import { randomInt } from 'node:crypto';

/** Randomly choose from the widest unused hue gap to keep neighbouring tags distinct. */
export function newTagHue(used: number[]): number {
  if (!used.length) return randomInt(360000) / 1000;
  const hues = [...new Set(used)].sort((a, b) => a - b);
  const gaps = hues.map((hue, i) => ({ start: hue, size: (hues[i + 1] ?? hues[0]! + 360) - hue }));
  const largest = Math.max(...gaps.map(gap => gap.size));
  const choices = gaps.filter(gap => gap.size >= largest * .9);
  const gap = choices[randomInt(choices.length)]!;
  return (gap.start + gap.size * (.4 + randomInt(200001) / 1000000)) % 360;
}
