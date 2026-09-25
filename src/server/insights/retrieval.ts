export const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
export function keywordScore(query: string, text: string) {
  const a = words(query),
    b = words(text);
  return a.size ? [...a].filter((word) => b.has(word)).length / a.size : 0;
}
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function rank<T extends { id: string; summary: string }>(
  query: string,
  vector: number[],
  rows: T[],
  vectors: Map<string, number[]>,
  mode: 'keyword' | 'semantic' | 'hybrid' = 'hybrid',
) {
  const lexical = [...rows].sort(
    (a, b) =>
      keywordScore(query, b.summary) - keywordScore(query, a.summary) || a.id.localeCompare(b.id),
  );
  const semantic = [...rows].sort(
    (a, b) =>
      cosine(vector, vectors.get(b.id) ?? []) - cosine(vector, vectors.get(a.id) ?? []) ||
      a.id.localeCompare(b.id),
  );
  if (mode === 'keyword') return lexical;
  if (mode === 'semantic') return semantic;
  const scores = new Map<string, number>();
  for (const list of [lexical, semantic])
    list.forEach((row, i) => scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (60 + i + 1)));
  return [...rows].sort(
    (a, b) => scores.get(b.id)! - scores.get(a.id)! || a.id.localeCompare(b.id),
  );
}
