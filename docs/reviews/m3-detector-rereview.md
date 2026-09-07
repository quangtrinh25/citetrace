# M3 isolated detector re-review

Re-reviewed 2026-09-07. Scope was limited to the five findings in
`docs/reviews/m3-detector-review.md`, their fixes in
`packages/core/src/detector.ts` and `registry.ts`, and the seven added assertions
in `packages/core/test/detector.test.ts`. No production files were changed.

## Prior finding status

- **I1, walrus binding in comprehensions — addressed.** Lines 69-79 now skip
  calls inside the comprehension while walking its assignment expressions and
  shadowing their targets in the containing scope. The reported later-call
  false attribution is covered at test lines 87-95.
- **I2, `setattr` module mutation — addressed.** Line 64 invalidates the
  statically visible receiver for direct `setattr`/`delattr` calls. The reported
  `nn.LayerNorm` stale import path now produces no suggestion and has a focused
  regression at test lines 87-95.
- **I3, calls in function signatures — addressed for the reported case.** Lines
  135-143 visit decorator/signature children in the declaration environment and
  scan the body separately. The exact `LoraConfig()` default now produces a LoRA
  suggestion anchored to `train`, asserted at test lines 97-101. A remaining
  signature-environment defect is reported below.
- **I4, unconditional bare `adam` and absent confusion metadata — addressed.**
  Lines 120-124 exclude the ambiguous lowercase method/function name, and
  `ConceptRule.hardNegatives` now records confusion examples for every rule,
  including the reported `Family.adam` case. The rule versions were advanced to
  `2`. This closes the implementation defect, but it does not replace the
  independently sampled held-out evaluation required by `plan.md`.
- **I5, PEP 695 binders — addressed for the reported false positives.** Line 63
  collects type-alias targets, and lines 137-143 isolate declaration type
  parameters from inherited imports. Both the module `type op = int` and
  `def build[op]()` regressions now produce no suggestion.

## New finding

### I6 — Important: declaration binders and PEP 695 bounds over-shadow valid enclosing-scope default/decorator calls

The new signature traversal receives `currentEnv` from `bindingsFor` at line
133. That environment has already collected the function/class name as a local
binding at lines 44-46, even though Python evaluates decorators and default
arguments before rebinding the declaration name. Therefore an unambiguous
imported call is missed when its alias matches the declaration name:

```ts
const result = await detect(
  'from peft import LoraConfig as train\n' +
  'def train(config=train()):\n' +
  '    return config\n',
);
expect(result.map(item => item.conceptId)).toEqual(['lora']);
```

Observed: `[]`. The same miss occurs for `@train()` before `def train()`.

There is a related over-shadow at lines 138 and 142: `targetNames` recursively
collects every identifier in `type_parameters`, including identifiers used in a
bound rather than only the parameter binder. This valid parsed example also
returns no suggestion:

```ts
await detect(
  'from peft import LoraConfig\n' +
  'def train[T: LoraConfig](config=LoraConfig()):\n' +
  '    return config\n',
);
```

The corresponding `def train[T](config=LoraConfig())` and
`def train[T: int](config=LoraConfig())` controls both produce one LoRA
suggestion, isolating the bound-name over-collection. Build a declaration
environment from the enclosing scope before adding the declaration's eventual
name, and collect only PEP 695 parameter binders rather than all identifiers in
their bounds/defaults.

## Verification

`./scripts/pnpm exec vitest run packages/core/test/detector.test.ts` passed all
**234/234** tests. Direct read-only probes reproduced I6 with no parser
diagnostics and zero suggestions in each failing case.

## Verdict

**Changes requested.** All five reported regressions are covered and their exact
reproductions are fixed, but I6 still misses explicit, resolved calls in the
signature/decorator surface that I3 added. The independent repository/family-
disjoint evaluation remains outstanding, so the passing controlled fixtures do
not establish the plan's precision or scoped-recall gate.
