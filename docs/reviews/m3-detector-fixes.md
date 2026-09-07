# M3 detector I6 fixes

Implemented and verified 2026-09-07. Scope was limited to I6 from
`docs/reviews/m3-detector-rereview.md` and its focused regressions.

## Root cause and fix

- Function and class names were collected as scope-wide bindings before their
  decorators and signature expressions were visited. Python evaluates those
  expressions before rebinding the declaration name. The detector now derives
  a definition-time environment that excludes only the declaration currently
  being evaluated. It handles Tree-sitter's `decorated_definition` wrapper so
  decorators and defaults use the same pre-rebinding environment. Separate
  assignments in the scope still conservatively invalidate the import.
- PEP 695 type parameters used recursive assignment-target collection, which
  also treated identifiers in bounds as binders. The detector now extracts one
  binder from each top-level type parameter and leaves bound references visible.
- Generic type aliases used the same recursive collector for their left side,
  causing bound references to shadow imports in the enclosing module. Type
  aliases now bind only their declared alias name.

The implementation is in `packages/core/src/detector.ts`. Six assertions were
added to `packages/core/test/detector.test.ts`: the two reviewed default and
decorator reproductions, three PEP 695 bound-reference cases, and an assignment
shadowing control.

## TDD evidence

Before the implementation change, the focused suite reported **5 failed and
235 passed**. Both definition-time cases and all three bound-reference cases
failed; the conservative assignment-shadowing control passed.

After the change:

- `./scripts/pnpm exec vitest run packages/core/test/detector.test.ts` —
  **240/240 passed**
- `./scripts/pnpm --filter @citetrace/core typecheck` — passed

This closes the reviewed I6 implementation defect. The independent held-out
evaluation described in `plan.md` remains a separate quality gate.

## I7 follow-up — class body scope transition

The final I6 re-review found that direct class-body execution still inherited
the environment in which the class name had already been rebound. The detector
now scans a class body with its pre-rebinding declaration environment, while
passing a distinct post-rebinding lexical parent to methods. This matches the
two execution phases without changing function-body behavior or the
conservative whole-class assignment policy.

Five focused assertions cover the exact class-body reproduction, the already
working class-base case, a recursive function call, an explicit class-body
assignment, and a method that executes after the class name is rebound.

- RED: `./scripts/pnpm exec vitest run packages/core/test/detector.test.ts`
  reported the exact I7 reproduction as **1 failed and 244 passed**; all four
  controls passed.
- GREEN: the same command passed **245/245** tests after the scope transition
  was separated.

This closes the controlled I7 defect. It does not establish the independent
repository/family-disjoint evaluation gate described in `plan.md`.
