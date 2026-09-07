# CiteTrace M0 scoped re-review

Reviewed 2026-09-06. Scope is limited to I1–I3 from the original review and behavior of their fixes. Read `/tmp/citetrace-m0-fixes.diff`, `/tmp/citetrace-m0-fix-report.md`, current changed sources and tests. No implementation files were changed; unrelated M0 design and later milestones were not reopened.

## Per-finding verdicts

### I1 — Resolved

`packages/core/src/notebook.ts:116-167` now distinguishes recognized markdown/raw cells from malformed entries and emits indexed `invalid-cell` errors. Direct compiled-core assertions confirmed diagnostics for null, number, array, missing type and unknown type, with recognized ignored cells omitted and a valid code peer retained.

Re-running the original compiled CLI fixture `/tmp/citetrace-m0-review-malformed.ipynb` now exits **1**, retains the valid `good` function, and reports `invalid-cell` at cell index 0. No regression found in this fix.

### I2 — Partially resolved; Important issue remains

The original malformed `if :`, `@dec(x=)` and adjacent `@broken(` examples now exclude the affected symbol, and anchor resolution returns `missing`. The non-root ancestor check addresses malformed owning syntax as intended.

However, the new recovery guard at `packages/core/src/python.ts:95-98` checks only the immediately previous named sibling and allows only whitespace between its error and the definition. Tree-sitter exposes comments as named siblings. Adding an ordinary intervening comment to the same incomplete-decorator case bypasses the guard:

```js
const py = source => analyzePython({ artifact: 'a.py', kind: 'file', source });
const before = await py('def f():\n pass\n');
const after = await py('@broken(\n# comment\ndef f():\n pass\n');
resolveAnchor(createAnchor(before, before.symbols[0]), [after]);
```

Observed with the current compiled core:

- `after.symbols` contains `f`.
- A `syntax-error` diagnostic is present.
- Resolution is `resolved`, **`needsReview: false`**, targeting `f` at line 2.

Expected: the intervening comment should not make the invalid decorator cease affecting the following definition; omit this affected candidate or otherwise prevent clean unchanged resolution. The recovery guard should account for comment trivia, with a regression for the above case and preservation of independent valid top-level definitions. This is a remaining instance of I2, not an unrelated new design requirement.

### I3 — Resolved

`packages/core/src/anchors.ts:64-81` checks every proper qualified-name prefix within the candidate's unit and is used by both named and structural matching routes. The duplicate-class, duplicate-outer-function and renamed structural cases have focused regression tests. Direct compiled-core checks confirmed the original `C`, `C`, `C.f` fixture is now ambiguous while an unchanged unique `C.f` still resolves. No regression found in this fix.

## Verification and overall verdict

- Independently reran the focused core suite: **47/47 tests passed** across notebook, Python and anchors.
- Independently ran compiled-core assertions and the compiled CLI checks described above.
- The fix report records a fresh build/typecheck and full **55/55** tests passing; this reviewer did not repeat the full subprocess suite.

**Changes requested solely for the remaining I2 comment-trivia case.** I1 and I3 are closed. No Critical findings and no unrelated new findings.
