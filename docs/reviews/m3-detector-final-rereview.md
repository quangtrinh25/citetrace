# M3 detector I6 final re-review

Re-reviewed 2026-09-07. Scope was limited to I6 in
`docs/reviews/m3-detector-rereview.md`, the implementation record in
`docs/reviews/m3-detector-fixes.md`, the corresponding changes in
`packages/core/src/detector.ts`, and the six new assertions at
`packages/core/test/detector.test.ts:103-129`. Concurrent M1 and M2 work was
excluded. No production files were changed.

## I6 status

**Partially addressed.** The exact two reported failures now use the correct
pre-rebinding import environment:

- A default expression whose imported alias matches the function name produces
  the expected LoRA suggestion anchored to that function.
- A decorator call through the same alias also produces the suggestion.

The PEP 695 over-shadowing cases are addressed as well. `typeParameterBinders`
at `packages/core/src/detector.ts:35-41` extracts one declared binder from each
top-level parameter instead of recursively treating bound references as
bindings. Generic type aliases bind only their alias name at lines 81-85. The
new tests establish that an imported name remains visible in a type-parameter
bound, a generic function body, and after a differently named generic alias.
The final assignment-shadowing control preserves the detector's documented
conservative behavior.

## New finding

### I7 — Important: a class body still inherits the post-rebinding environment

Python evaluates a class body before assigning the resulting class object to
the declaration name, just as it evaluates the class's decorators and bases
before that assignment. The fix correctly uses `declarationEnv` for decorators
and signature children at lines 157-170, but line 172 builds the class-body
parent from `currentEnv`. That environment already contains the class name as a
scope-wide binding, so it hides an otherwise resolved import used directly in
the class body:

```ts
const result = await detect(
  'from peft import LoraConfig as Train\n' +
  'class Train:\n' +
  '    config = Train()\n',
);
expect(result.map(item => item.conceptId)).toEqual(['lora']);
```

Observed: `[]`, with no parser diagnostics. This is explicit imported-call
evidence and should produce one LoRA suggestion anchored to `Train`.

Three targeted controls isolate the scope transition:

- `class Train(Train()): ...` already produces LoRA evidence because the base
  expression uses `declarationEnv`.
- `def train(): return train()` correctly produces no evidence because a
  function body executes after the function name is rebound.
- A class body that explicitly assigns `Train = custom` before calling it also
  correctly produces no evidence under the conservative whole-scope policy.

Scan a class body with the pre-rebinding declaration environment, while keeping
the post-rebinding environment as the lexical parent inherited by its methods.
Add the reproduction and the function-body control so a shared change does not
incorrectly revive imports in recursive function or method bodies.

## Verification

The implementation report records **240/240** focused detector tests passing
and a passing `@citetrace/core` typecheck. Per the bounded brief, those
known-passing commands were not repeated. A direct read-only probe reproduced
I7 and the three controls above.

## Verdict

**Changes requested.** The six added regressions are well targeted and close
the reported default/decorator and PEP 695 cases, but the same definition-time
binding rule is still incomplete for executable class bodies. No other new
breakage was found in the scoped fix. The independent repository/family-
disjoint evaluation remains a separate quality gate and is not established by
the controlled 240-test suite.
