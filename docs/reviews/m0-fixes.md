# CiteTrace M0 final-review fix report

Date: 2026-09-06

## Scope

Implemented the three confirmed findings in `/tmp/citetrace-m0-final-review.md` within the assigned files only. No dependencies, shared types, documentation, or unrelated CLI behavior were changed. No git operations were run.

Changed files:

- `packages/core/src/notebook.ts`
- `packages/core/test/notebook.test.ts`
- `packages/core/src/python.ts`
- `packages/core/test/python.test.ts`
- `packages/core/src/anchors.ts`
- `packages/core/test/anchors.test.ts`
- `packages/cli/test/cli.test.ts`

## I1: malformed notebook entries

Root cause: `readNotebook` returned early both for non-object entries and for every non-`code` `cell_type`, so malformed entries were indistinguishable from the recognized ignored `markdown` and `raw` types.

Test-first change:

- Added a core regression containing `null`, a number, an array, a missing `cell_type`, an unknown `cell_type`, recognized markdown/raw peers, and a valid code peer. It requires one indexed `invalid-cell` error for each malformed entry and retains the valid code unit.
- Added a compiled CLI subprocess regression with a malformed entry plus a valid code cell. It requires exit code 1, an indexed `invalid-cell` error, and the valid function in output.

RED evidence:

- `./scripts/pnpm exec vitest run packages/core/test/notebook.test.ts`
  - Exit 1; 1 test file failed.
  - 1 failed, 19 passed, 20 total.
  - New regression received `diagnostics: []` instead of five indexed errors.
- Before rebuilding the compiled CLI artifact: `./scripts/pnpm exec vitest run packages/cli/test/cli.test.ts` (escalated)
  - Exit 1; 1 test file failed.
  - 1 failed, 7 passed, 8 total.
  - New regression received exit code 0 instead of 1.

GREEN implementation:

- Non-object entries now emit indexed `invalid-cell` errors.
- Only `markdown` and `raw` return intentionally without a cell-type error.
- Missing and unknown cell types emit indexed `invalid-cell` errors.
- Existing code-cell source and ID validation remains unchanged.

GREEN evidence:

- `./scripts/pnpm exec vitest run packages/core/test/notebook.test.ts`
  - Exit 0; 1 test file passed; 20 passed, 20 total.
- `./scripts/pnpm build`
  - Exit 0; core and CLI TypeScript builds completed.
- `./scripts/pnpm exec vitest run packages/cli/test/cli.test.ts` (escalated)
  - Exit 0; 1 test file passed; 8 passed, 8 total.

## I2: definitions under malformed Python syntax

Root cause: symbol collection checked only the local `class_definition` or `function_definition` node. Tree-sitter can leave that node locally valid while an enclosing statement or `decorated_definition` has errors. For `@broken(` it emits a module-level `ERROR` followed by an apparently undecorated function, so ancestor checks alone are insufficient.

Test-first change:

- Added parser regressions for all reviewer examples:
  - `if :` enclosing a function.
  - `@dec(x=)` decorating a function.
  - `@broken(` recovered as a separate error before an apparently undecorated function.
- Each fixture also contains an independent valid top-level `good` function, which must remain available.
- Added an anchor regression requiring the original `f` anchor to be missing after `f` appears only beneath malformed `if :` syntax.

RED evidence:

- `./scripts/pnpm exec vitest run packages/core/test/python.test.ts`
  - Exit 1; 1 test file failed.
  - 3 failed, 8 passed, 11 total.
  - Every reviewer fixture returned `['good', 'affected']` instead of `['good']`.
- `./scripts/pnpm exec vitest run packages/core/test/anchors.test.ts`
  - Exit 1; 1 test file failed.
  - 1 failed, 12 passed, 13 total.
  - Malformed-wrapper anchor resolved instead of returning missing.

Implementation refinement evidence:

- The first context implementation made all new I2 regressions pass but exposed one existing failure in `python.test.ts`: 1 failed, 10 passed, 11 total. Tree-sitter can make a file-wide recovery `ERROR` the root node, so treating that synthetic root as an enclosing construct incorrectly removed an independent top-level `good` definition.
- The rule was narrowed to error-bearing owning ancestors below the root, plus an adjacent decorator-like `ERROR` separated from a recovered definition by whitespace only.

GREEN implementation:

- Definitions are skipped when their local node or a real non-root owning ancestor contains syntax errors.
- A definition immediately following an adjacent decorator-like recovery `ERROR` is skipped, covering incomplete decorators recovered outside `decorated_definition`.
- The synthetic parser root is not treated as an invalid enclosing construct, preserving independent valid top-level definitions.

GREEN evidence:

- `./scripts/pnpm exec vitest run packages/core/test/python.test.ts`
  - Exit 0; 1 test file passed; 11 passed, 11 total.
- `./scripts/pnpm exec vitest run packages/core/test/anchors.test.ts`
  - Exit 0; 1 test file passed; 13 passed, 13 total at this I2 checkpoint.

## I3: descendants through duplicate enclosing definitions

Root cause: resolver ambiguity checks considered only the descendant candidate count/full qualified name. A lone `C.f` therefore resolved even when its source unit contained two definitions of ancestor `C`.

Test-first change:

- Added a named `C.f` case where two `C` classes exist but only one contains `f`.
- Added a named `outer.inner` case where two `outer` functions exist but only one contains `inner`.
- Added a structural relocation case where renamed/moved method `Renamed.moved` appears under one of two `Renamed` classes.
- Single descendant candidates remain listed in each ambiguous result, as allowed by the task contract.

RED evidence:

- `./scripts/pnpm exec vitest run packages/core/test/anchors.test.ts`
  - Exit 1; 1 test file failed.
  - 3 failed, 13 passed, 16 total.
  - All three duplicate-ancestor cases resolved instead of returning ambiguous.

GREEN implementation:

- For each symbol candidate, every proper qualified-name prefix is checked against symbols in the same `UnitAnalysis`.
- If any ancestor prefix occurs more than once, symbol resolution returns `ambiguous` even when there is only one direct descendant candidate.
- The check is applied to named matches and fingerprint-based structural relocation matches. It uses no line numbers, cell indices, or source order.

GREEN evidence:

- `./scripts/pnpm exec vitest run packages/core/test/anchors.test.ts`
  - Exit 0; 1 test file passed; 16 passed, 16 total.

## Fresh final verification

Focused core tests, rerun after all production changes:

- `./scripts/pnpm exec vitest run packages/core/test/notebook.test.ts`
  - Exit 0; 1 file passed; 20 passed, 20 total.
- `./scripts/pnpm exec vitest run packages/core/test/python.test.ts`
  - Exit 0; 1 file passed; 11 passed, 11 total.
- `./scripts/pnpm exec vitest run packages/core/test/anchors.test.ts`
  - Exit 0; 1 file passed; 16 passed, 16 total.

Compiled CLI:

- `./scripts/pnpm build`
  - Exit 0; core and CLI TypeScript builds completed.
- `./scripts/pnpm exec vitest run packages/cli/test/cli.test.ts` (escalated)
  - Exit 0; 1 file passed; 8 passed, 8 total.

Full required gate:

- `./scripts/pnpm check` (escalated because synchronous Node subprocess output capture is blocked by the sandbox)
  - Exit 0.
  - Workspace build passed for core and CLI.
  - Root TypeScript typecheck passed.
  - Vitest: 4 test files passed; 55 tests passed, 55 total.

## Concerns

None within M0 scope. The incomplete-decorator guard is deliberately narrow: it recognizes Tree-sitter's adjacent decorator-like recovery error without attempting Python semantic validation or executing source.
