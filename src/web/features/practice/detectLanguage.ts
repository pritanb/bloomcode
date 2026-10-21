/**
 * Guesses a solution's language from LeetCode-style code. The first rule that matches wins, so
 * the order matters: e.g. TypeScript is checked before Java because both can write `Map<`.
 * Returns null when no rule is sure; the caller then keeps the current language.
 */
const rules: [language: string, pattern: RegExp][] = [
  // `def twoSum(self, nums: List[int]) -> List[int]:` or `class Solution:`
  ['python', /^\s*(def\s+\w+\s*\(.*\)\s*(->.*)?|class\s+\w+(\(.*\))?):\s*$/m],
  // `func twoSum(nums []int, target int) []int {`; no colons or arrows, unlike Swift.
  ['go', /^\s*func\s[^:>\n]*\{\s*$|^\s*package\s+\w+\s*$/m],
  [
    'cpp',
    /#include|std::|\b(vector|unordered_map|unordered_set|pair)<|^\s*public:|\bnullptr\b|\w->(left|right|next|val)\b/m,
  ],
  ['typescript', /:\s*(number|string|boolean|void|any)\b/],
  ['javascript', /\bfunction\b|\b(let|const)\s+\w+\s*=|=>|console\.log/],
  [
    'java',
    /\b(public|private)\s+\w|\b(int|long|char|boolean|double|String)\[\]|\b(HashMap|ArrayList|HashSet|ArrayDeque|PriorityQueue)<|System\.out/,
  ],
];

export function detectLanguage(code: string): string | null {
  return rules.find(([, pattern]) => pattern.test(code))?.[0] ?? null;
}
