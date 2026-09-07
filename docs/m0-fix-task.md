# M0 final-review fix task

Read `/tmp/citetrace-m0-final-review.md` for three confirmed findings. Parent
independently reproduced all three with compiled core. Fix all in one wave,
one finding at a time with focused RED/GREEN tests. Do not spawn subagents.

Own only `packages/core/src/{notebook,python,anchors}.ts`, their corresponding
test files, and `packages/cli/test/cli.test.ts` if needed for the input regression.
Do not change dependencies, documentation, shared types or unrelated CLI behavior.

I1: malformed notebook entries (null, numbers, arrays, missing/unknown cell_type)
must yield indexed invalid-cell errors, while valid peers remain available. Only
recognized markdown and raw cells are intentionally ignored. Add compiled CLI
regression showing error exit code for malformed cell entries (not only JSON errors).

I2: exclude Python definitions if decorator or any non-module enclosing syntax
is invalid. Preserve independent valid top-level definitions in the same file.
Test all reviewer examples, including incomplete decorators that Tree-sitter can
recover as an apparently undecorated function. Regression should show the original
function anchor does not resolve cleanly to code under the malformed wrapper.
Do not attempt full Python semantic validation or execute code.

I3: qualified name alone cannot resolve a descendant through duplicate enclosing
definitions in the same source unit. Detect duplicate ancestor scopes (class or
outer function) and return ambiguous, for named matches and structural relocation
candidates alike. Do not use source order or line numbers to choose. Keep existing
unique rename/move/cell behavior. Add duplicate-class, duplicate-outer-function,
and relocation-into-duplicate-scope cases. It is acceptable for an ambiguous result
to list a single directly matching descendant when its enclosing scope is ambiguous.

Tests: `./scripts/pnpm exec vitest run packages/core/test/<file>.test.ts`.
Build before CLI tests with `./scripts/pnpm build`; CLI subprocess tests need the
already approved escalated command `./scripts/pnpm exec vitest run packages/cli/test/cli.test.ts`.
Full final check: `./scripts/pnpm check`, with sandbox_permissions=require_escalated,
because sandbox synchronous Node subprocess stdout capture returns EPERM. The
prefix is approved. Record complete test counts, not just assertion summaries.

No git operations: .git is externally managed and not a usable repository. Write
your full report and RED/GREEN evidence to `/tmp/citetrace-m0-fix-report.md`. Return
only status, tests summary, changed files and concerns. Parent will run scoped review.
