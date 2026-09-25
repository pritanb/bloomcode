import type { Snapshot } from './contracts.js';

type Row = Record<string, unknown>;
/** Deterministic so older portable backups can be verified after consolidation. */
export function consolidatePatternTables(source: Snapshot['tables']): Snapshot['tables'] {
  const tables = structuredClone(source);
  tables.patterns ??= [];
  if (!tables.patterns.length) return tables;
  const tags = tables.tags!;
  const links = tables.problem_tags!;
  const append = (existing: unknown, incoming: unknown) => {
    const first = typeof existing === 'string' ? existing : '';
    const second = typeof incoming === 'string' ? incoming : '';
    return !second || second === first ? first : first ? `${first}\n\n${second}` : second;
  };
  for (const pattern of tables.patterns) {
    let tag = tags.find(
      (t) => String(t.name).trim().toLowerCase() === String(pattern.title).trim().toLowerCase(),
    );
    if (!tag) {
      let id = `pattern-${pattern.id}`;
      while (tags.some((t) => t.id === id)) id += '-imported';
      // A stable unused color, without changing any existing tag's color.
      let hue = [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 360, 0);
      while (tags.some((t) => t.hue === hue)) hue = (hue + 0.1) % 360;
      tag = { id, name: pattern.title, description: '', archived: false, hue, kind: 'pattern' };
      tags.push(tag);
    }
    tag.recognitionCues = append(tag.recognitionCues, pattern.recognitionCues);
    tag.pitfalls = append(tag.pitfalls, pattern.pitfalls);
    tag.patternNotes = append(tag.patternNotes, pattern.notes);
    tag.notebookVersion = Math.max(Number(tag.notebookVersion ?? 0), Number(pattern.version)) + 1;
    tag.notebookUpdatedAt = [tag.notebookUpdatedAt, pattern.updatedAt]
      .filter(Boolean)
      .map(String)
      .sort()
      .at(-1);
    for (const problemId of pattern.exampleProblemIds as string[]) {
      if (!links.some((link) => link.problemId === problemId && link.tagId === tag.id)) {
        let id = `${problemId}:${tag.id}`;
        while (links.some((link) => link.id === id)) id += '-imported';
        links.push({ id, problemId, tagId: tag.id, difficulty: null });
      }
    }
  }
  tables.patterns = [];
  return tables;
}

export function patternNotebook(tag: Row) {
  return {
    id: String(tag.id),
    title: String(tag.name),
    description: String(tag.description ?? ''),
    archived: Boolean(tag.archived),
    recognitionCues: String(tag.recognitionCues ?? ''),
    pitfalls: String(tag.pitfalls ?? ''),
    notes: String(tag.patternNotes ?? ''),
    version: Number(tag.notebookVersion ?? 1),
    updatedAt: tag.notebookUpdatedAt ? String(tag.notebookUpdatedAt) : null,
  };
}
