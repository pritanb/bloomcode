import type { Observation } from '../../shared/insights.js';
import { cosine, keywordScore, rank, words } from './retrieval.js';

export interface PatternCandidate {
  anchorId: string;
  evidenceIds: string[];
  requiredEvidenceIds: string[];
}

/** Retrieval candidates, not diagnoses. No date cutoff and no model calls. */
export function patternCandidates(
  rows: Observation[],
  vectors: Map<string, number[]>,
): PatternCandidate[] {
  const remaining = new Set(rows.map((row) => row.id));
  const groups: { candidate: PatternCandidate; problems: number; difficulties: number }[] = [];
  const seeds = [...rows].sort(
    (a, b) =>
      Number(b.polarity === 'difficulty') - Number(a.polarity === 'difficulty') ||
      a.id.localeCompare(b.id),
  );
  for (const anchor of seeds) {
    if (!remaining.has(anchor.id)) continue;
    const vector = vectors.get(anchor.id) ?? [];
    const related = rows.filter(
      (row) =>
        remaining.has(row.id) &&
        (row.id === anchor.id ||
          (vector.length && vectors.get(row.id)?.length === vector.length
            ? cosine(vector, vectors.get(row.id)!) >= 0.65
            : words(anchor.summary).size >= 3 &&
              words(row.summary).size >= 3 &&
              keywordScore(anchor.summary, row.summary) >= 0.6 &&
              keywordScore(row.summary, anchor.summary) >= 0.6)),
    );
    const ranked = rank(anchor.summary, vector, related, vectors);
    for (const row of related) remaining.delete(row.id);
    const support = ranked.find(
      (row) => row.polarity === anchor.polarity && row.problemId !== anchor.problemId,
    );
    const contrary = ranked.find((row) => row.polarity !== anchor.polarity);
    // Keep cross-problem support and counterevidence ahead of optional neighbours.
    const required = [anchor, support, contrary].filter((row): row is Observation => !!row);
    const evidenceIds = [...new Set([...required, ...ranked].map((row) => row.id))];
    groups.push({
      candidate: {
        anchorId: anchor.id,
        requiredEvidenceIds: required.map((row) => row.id),
        evidenceIds,
      },
      problems: new Set(related.map((row) => row.problemId)).size,
      difficulties: new Set(
        related.filter((row) => row.polarity === 'difficulty').map((row) => row.problemId),
      ).size,
    });
  }
  return groups
    .sort(
      (a, b) =>
        b.difficulties - a.difficulties ||
        b.problems - a.problems ||
        a.candidate.anchorId.localeCompare(b.candidate.anchorId),
    )
    .map((group) => group.candidate);
}
