# CiteTrace M0 final read-only review

Reviewed 2026-09-06 against `/tmp/citetrace-m0-review.diff`, current implementation files, `plan.md`, and current `docs/progress.md`. Scope is environment plus M0; later ledger, detectors, VS Code, publishing and V0.1 acceptance gates are deliberately excluded. No implementation files were changed.

## Critical

None found.

## Important

### I1. Malformed notebook entries are silently accepted as completely inspected

Location: `packages/core/src/notebook.ts:116-143`; resulting exit status: `packages/cli/src/main.ts:77-78`.

The reader silently returns from non-object entries and from every unknown or missing `cell_type`. These are malformed cells, not recognized markdown/raw cells. Consequently malformed content can disappear from the inspection while the CLI reports success without diagnostics.

Reproduction:

```js
readNotebook('a.ipynb', JSON.stringify({
  nbformat: 4,
  metadata: { language_info: { name: 'python' } },
  cells: [null, { cell_type: 'code', source: 'def good():\n pass\n' }]
}));
```

Observed: the valid code cell is retained, `diagnostics: []`. Individually, entries `null`, `42`, `{}`, and `{cell_type:'cod', source:'def f(): pass'}` also produce no diagnostics. A real compiled CLI invocation against `/tmp/citetrace-m0-review-malformed.ipynb` returned exit code **0** and an empty diagnostic array.

Expected: preserve valid cells, but produce indexed `invalid-cell` error diagnostics for non-object entries and missing/unknown cell types; only recognized markdown/raw cells should be intentionally ignored. CLI should return 1 for the malformed input. This matters because the accepted plan forbids presenting incomplete parsing as a complete scan, and the progress interface explicitly promises malformed input is reported.

### I2. Symbols inside syntax-invalid wrappers remain eligible for clean anchor resolution

Location: `packages/core/src/python.ts:88-103`, especially checking only the definition node at line 92 and walking arbitrary parent nodes at line 103; `packages/core/src/anchors.ts:55-57` and `88-91` consume those symbols without further validity checks.

A definition may have a valid local subtree while its decorator or enclosing control statement is malformed. The parser still emits that definition, despite its diagnostic saying affected definitions were skipped. Some such edits leave the symbol fingerprint unchanged, so the resolver returns `needsReview: false`.

Reproduction using the built core:

```js
const py = source => analyzePython({ artifact:'a.py', kind:'file', source });
const before = await py('def f():\n pass\n');
const after = await py('if :\n def f():\n  pass\n');
resolveAnchor(createAnchor(before, before.symbols[0]), [after]);
```

Observed: `after` contains a syntax-error diagnostic **and** symbol `f`; resolution is `{status:'resolved', needsReview:false, target:{artifact:'a.py', symbol:'f', ...}}`.

A second concrete case, `@dec(x=)\ndef f():\n pass\n`, emits `f` with its malformed decorated range because `decorated_definition.hasError` is never checked. `@broken(\ndef f():\n pass\n` similarly recovers an apparently undecorated `f`.

Expected: exclude definitions whose decorator or non-module enclosing syntax is invalid, while retaining independent valid top-level definitions; at minimum prevent those affected candidates from being accepted as clean unchanged anchor resolutions. Add focused malformed-decorator and malformed-enclosing-statement tests. This is an M0 parsing/anchor validity issue, not a request for full Python semantic validation.

### I3. Duplicate enclosing Python scopes do not make descendant anchors ambiguous

Location: `packages/core/src/anchors.ts:86-92`; scope representation originates in `packages/core/src/python.ts:96-100`.

Only duplicate full qualified symbol names are guarded. Duplicate classes or outer functions are not checked when resolving descendants. A single matching `C.f` is accepted even though the path through `C` is no longer unique. That is the same container-identity uncertainty already guarded for notebook cells at lines 76-77, and permits a clean binding to a different duplicate container.

Reproduction:

```js
const before = await py('class C:\n def f(self):\n  return 1\n');
const after = await py('class C:\n pass\nclass C:\n def f(self):\n  return 1\n');
resolveAnchor(createAnchor(before, before.symbols[1]), [after]);
```

Observed symbol names: `['C', 'C', 'C.f']`. Resolution returns `resolved`, `needsReview:false`, selecting the second class's method. If the original class lost its method and a separate class was copied in, the resolver cannot establish which enclosing `C` is the anchor's original scope.

Expected: conservatively report ambiguity for descendant identity paths containing duplicate enclosing definitions, including nested functions, or preserve enough enclosing-scope evidence to prove a unique container. Add duplicate-class and duplicate-outer-function regression cases; do not use line order to decide identity.

## Minor

No additional actionable findings. The current progress file accurately distinguishes completed M0 implementation from pending review, and README/quickstart clearly identify later features as unavailable. The cross-platform CI workflow is explicitly documented as not yet run on hosted runners.

## Spec verdict

**Changes requested for the M0 acceptance gate.** Implemented architecture and delivered scope align well with the accepted roadmap: strict TypeScript core, actual Tree-sitter WASM, pure notebook reading, serializable source-free anchors, read-only CLI and explicit later milestones. I1 violates truthful malformed-input reporting; I2 and I3 weaken the conservative matching/syntax guarantees that are the purpose of M0. No missing later milestone is treated as a defect.

## Quality verdict

**Changes requested; small, focused corrections rather than redesign.** Source boundaries are clear, parser lifetime cleanup is present, meaningful literal/operator tokens are fingerprinted, notebook input is not executed or rewritten, and CLI per-file failures are surfaced. The reported build/typecheck and 46-test suite passed outside the sandbox. This review independently ran the compiled core and CLI reproductions above; those uncovered meaningful edge cases absent from the existing suite. No claim is made that the full suite was rerun by this reviewer, nor that the known sandbox child-process EPERM is a product failure.
