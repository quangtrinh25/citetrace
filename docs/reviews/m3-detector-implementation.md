# M3 detector implementation, 2026-09-06

Scope: `core/src/detector.ts`, `registry.ts`, exported reusable language loader in
`python.ts`, `core/test/detector.test.ts`. No network or code execution in detector.

TDD: 228 controlled tests initially produced 101 assertion failures with the
empty detector stub (100 positive cases and grouping); 127 negatives passed.
Implementation: lexical AST binding collection, conservative shadow handling,
explicit definition aliases, nearest-symbol grouping, ranges and paper candidate IDs.
Final focused command `./scripts/pnpm exec vitest run packages/core/test/detector.test.ts`
passed 228 tests. A mutation fixture initially reassigned `n` instead of `nn`;
AST inspection identified the test typo and it was corrected. No production
workaround for the typo remains.

These are synthetic development/regression cases, **not held-out precision
evidence**. Import calls in lambdas/comprehensions/match and conditional imports
are deliberately outside coverage; ambiguous or syntactically invalid units
yield no automatic suggestions. No cross-cell execution-order inference.

Paper metadata source: each `RegistryPaper.url` is its primary arXiv abstract
page, inspected 2026-09-06. The candidate's association to an API/name does not
prove the user's implementation originated in that paper.
