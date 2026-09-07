# M3 isolated detector review

Reviewed 2026-09-07. Scope was limited to `packages/core/src/detector.ts`,
`registry.ts`, the `pythonLanguage` export in `python.ts`, and
`packages/core/test/detector.test.ts`, against the detector requirements in
`plan.md`. No production files were changed and unfinished M1 work was not
reviewed.

## Findings

### I1 — Important: a walrus in a comprehension escapes the skipped scope and permits false attribution

`packages/core/src/detector.ts:65-69` treats every comprehension as an isolated
scope and returns before visiting its `named_expression`. That is incorrect for
Python assignment expressions: the target of a walrus in a comprehension binds
in the containing scope. Consequently the detector retains the earlier import
binding and attributes a later call through an unrelated local value.

Runnable regression using the `detect` helper already defined at
`packages/core/test/detector.test.ts:19-21`:

```ts
expect(await detect(
  'from torch.nn import LayerNorm as op\n' +
  'items = [(op := custom) for item in values]\n' +
  'value = op(4)\n',
)).toEqual([]);
```

Observed: one `layernorm` suggestion with imported-call evidence
`torch.nn.LayerNorm` on the final line. Expected: no suggestion, because `op`
has been rebound in the surrounding module scope. Preserve the decision to skip
calls inside comprehensions, but propagate walrus targets to the containing
binding collector.

### I2 — Important: statically visible `setattr` mutation is still treated as a resolved library call

The contract comment at `packages/core/src/detector.ts:25-27` says mutated module
attributes are uncertain. Direct assignment is handled through `targetNames` at
line 61, but the equally explicit built-in mutation below is not. Lines 79-85
therefore resolve the later attribute through the stale import binding.

```ts
expect(await detect(
  'import torch.nn as nn\n' +
  'setattr(nn, "LayerNorm", custom)\n' +
  'value = nn.LayerNorm(4)\n',
)).toEqual([]);
```

Observed: one `layernorm` suggestion with evidence `torch.nn.LayerNorm`.
Expected: no suggestion because the exact registry attribute was replaced.
A conservative detector can invalidate `nn` for a statically recognizable
`setattr(nn, <string>, ...)`, without trying to model arbitrary dynamic code.

### I3 — Important: calls in function signatures are omitted even when their import is unambiguous

`packages/core/src/detector.ts:124-130` descends directly into a function's body
and returns, so it never visits default values or annotations in the function
signature. A constructor call in a default value is explicit AST call evidence,
is evaluated in the enclosing scope, and has a directly resolved import, but is
missed:

```ts
const result = await detect(
  'from peft import LoraConfig\n' +
  'def train(config=LoraConfig()):\n' +
  '    return config\n',
);
expect(result.map(item => item.conceptId)).toEqual(['lora']);
```

Observed: `[]`. Expected: a `lora` suggestion anchored to `train`, with evidence
on the default-value call. Visit the definition's decorator/signature children
under the enclosing environment before scanning its body with the child scope;
do not treat parameter names as bindings while resolving default values.

### I4 — Important specification and quality gap: rules have no confusion cases and ambiguous names are unconditional positives

`plan.md:39-42` requires every rule to carry likely-confusion cases and allows
name evidence only for clear symbol names. `ConceptRule` at
`packages/core/src/registry.ts:4` has no confusion/hard-negative metadata, and
`packages/core/src/detector.ts:110-113` accepts every normalized alias without
context or a per-alias evidence policy. The generated positives at
`packages/core/test/detector.test.ts:24-26` even label trivial bodies as positive
for every concept. This makes an obvious unrelated name collision a suggestion:

```ts
expect(await detect(
  'class Family:\n' +
  '    def adam(self):\n' +
  '        return self.children[0]\n',
)).toEqual([]);
```

Observed: one `adam` suggestion with `definition-name` evidence. This is not a
resolved library call or meaningful optimizer evidence. Add the required
per-rule confusion fixtures/policy and stop treating ambiguous bare aliases such
as lowercase `adam` as sufficient definition evidence in every context. At a
minimum this case belongs in hard negatives rather than the template-generated
positive set.

### I5 — Moderate: Python 3.12 binding constructs are absent from lexical shadow collection

The bundled grammar parses PEP 695 syntax without diagnostics, but
`bindingsFor` at `packages/core/src/detector.ts:43-71` does not collect
`type_alias_statement` targets or function/class `type_parameters`. Those names
can therefore retain an inherited import identity. A compact module-level repro
is:

```ts
expect(await detect(
  'from torch.nn import LayerNorm as op\n' +
  'type op = int\n' +
  'value = op(4)\n',
)).toEqual([]);
```

Observed: one `layernorm` suggestion attributed through `torch.nn.LayerNorm`.
Expected: no suggestion because the `type` statement binds `op`. The same stale
resolution occurs for `def build[op](): return op(4)`. Collect these binders or
explicitly reject scopes containing unsupported binding constructs.

## Passing checks

- The focused command
  `./scripts/pnpm exec vitest run packages/core/test/detector.test.ts` passed all
  **228/228** controlled tests.
- The registry contains exactly the ten planned concepts, stable rule version
  strings, aliases, call paths, and candidate IDs. Titles, authors, arXiv IDs,
  and first-submission years match the ten linked primary arXiv abstract pages
  as inspected on 2026-09-07.
- Comments, strings, unused imports, relative imports, star imports, tested
  conditional imports, parameters, assignments, loops, class-to-method lexical
  separation, direct module-attribute assignment, and parse diagnostics do not
  generate the tested false suggestions.
- Repeated calls group by concept plus nearest symbol anchor and retain each
  evidence range. Candidate metadata and comments consistently describe the
  paper as a candidate, not proof of origin, and no probability or calibrated
  precision is claimed.
- `pythonLanguage` remains a one-function reusable cached loader and introduces
  no detector-specific side effect beyond parser initialization and WASM load.

## Verdict

**Changes requested.** The basic M3 detector shape and candidate metadata satisfy
most structural requirements, but I1, I2, I4, and I5 provide concrete lexical
false positives, while I3 misses an ordinary explicit imported constructor call.
These attribution errors should be fixed and covered with focused regressions
before treating the isolated detector as implementation-complete.

The quality gate is also **not established**. The passing 228 cases are templated
development fixtures, not a repository/family-disjoint held-out evaluation. No
precision >=90% or scoped recall result can be inferred from them, as the test
comment and implementation report correctly acknowledge. The plan's held-out
quality evaluation remains required after the lexical findings are addressed.
