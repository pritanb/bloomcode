# Bundled list data

`neetcode-problems.json` is `.problemSiteData.json` from [neetcode-gh/leetcode](https://github.com/neetcode-gh/leetcode), unchanged.

- Revision: `9f104d45b1efc8c2e42b6dcc7b1216cdf8c4f80e`
- SHA-256: `436dd487beb9126e30e9da8717ff76f2a78e3a94ca0ec4181d9d04de9f7b953c` (checked by `../lists.ts` before import)
- License: MIT, see `LICENSE-neetcode.txt`

The app uses its `neetcode150` and `blind75` flags and each row's category. Other lists can be imported as question packs; see [docs/extensions.md](../../../docs/extensions.md).

`zerotrac-ratings.txt` is `ratings.txt` from [zerotrac/leetcode_problem_rating](https://github.com/zerotrac/leetcode_problem_rating), unchanged: Elo-style difficulty ratings for LeetCode weekly/biweekly contest problems (contest 63 onward).

- Revision: `8c7a54008482a8b7464bedfb8ca2f3ea172aa0df`
- SHA-256: `c0da4136769e9f86e8faaccc5b710430a34075a7525c08783afaf8c572f3c58d` (checked by `src/server/topics/ratings.ts` on load)
- License: MIT, see `LICENSE-zerotrac.txt`

Problems without a contest rating get an estimate fitted on these ratings when the learner downloads the problem bank; LeetCode's own metadata is fetched on their machine and never committed here.
