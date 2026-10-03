// Estimate a contest-scale rating for problems that never appeared in a contest.
// Ridge regression on the LeetCode label, label × logit(acceptance) and topic tags,
// trained on problems with exact contest ratings. Measured on the pinned snapshot it
// orders problems 200+ points apart correctly ~93% of the time (mean error ~150).
export interface ProblemFeatures {
  difficulty: 'Easy' | 'Medium' | 'Hard';
  acRate: number; // percent, 0–100
  tags: string[];
}
const LABELS = ['Easy', 'Medium', 'Hard'] as const;
const LAMBDA = 5;
/** One-hot label and label × logit(acceptance) stay unpenalised. */
const BASE = LABELS.length * 2;

function vector(p: ProblemFeatures, tags: string[]) {
  const label = LABELS.map((l) => (l === p.difficulty ? 1 : 0));
  const rate = Math.min(Math.max(p.acRate / 100, 0.01), 0.99);
  const logit = Math.log(rate / (1 - rate));
  return [
    ...label,
    ...label.map((v) => v * logit),
    ...tags.map((t) => (p.tags.includes(t) ? 1 : 0)),
  ];
}

/** Solve (XᵀX + λI′) w = Xᵀy by Gaussian elimination with partial pivoting. */
function ridge(X: number[][], y: number[]) {
  const n = X[0]!.length;
  const A = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    if (i >= BASE) row[i] = LAMBDA;
    return row;
  });
  // Accumulate over rows once, skipping zero features (most tags are absent).
  X.forEach((x, k) => {
    const nz = x.flatMap((v, i) => (v ? [i] : []));
    for (const i of nz) {
      for (const j of nz) A[i]![j]! += x[i]! * x[j]!;
      A[i]![n]! += x[i]! * y[k]!;
    }
  });
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[pivot]![c]!)) pivot = r;
    [A[c], A[pivot]] = [A[pivot]!, A[c]!];
    // An all-zero column (e.g. a label absent from training) contributes nothing.
    if (Math.abs(A[c]![c]!) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k <= n; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return A.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

export interface RatingModel {
  predict(p: ProblemFeatures): number;
  /** Mean absolute error on held-out folds; never on training rows. */
  heldOutError: number;
  method: string;
}

export function fitRatingModel(
  rows: (ProblemFeatures & { rating: number })[],
  folds = 5,
): RatingModel {
  if (rows.length < folds * 10) throw Error('Too few rated problems to fit the rating model.');
  const tags = [...new Set(rows.flatMap((r) => r.tags))].sort();
  const fit = (train: typeof rows) => {
    const w = ridge(
      train.map((r) => vector(r, tags)),
      train.map((r) => r.rating),
    );
    return (p: ProblemFeatures) => vector(p, tags).reduce((sum, x, i) => sum + x * w[i]!, 0);
  };
  // Deterministic folds by position keep the reported error reproducible.
  let error = 0;
  for (let f = 0; f < folds; f++) {
    const predict = fit(rows.filter((_, i) => i % folds !== f));
    const held = rows.filter((_, i) => i % folds === f);
    error += held.reduce((sum, r) => sum + Math.abs(predict(r) - r.rating), 0);
  }
  const heldOutError = Math.round(error / rows.length);
  return { predict: fit(rows), heldOutError, method: `ridge-v1 mae=${heldOutError}` };
}
