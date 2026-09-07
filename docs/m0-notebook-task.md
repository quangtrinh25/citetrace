# M0 notebook reader task

Work only in `packages/core/src/notebook.ts` and
`packages/core/test/notebook.test.ts`. Shared contracts already exist in
`packages/core/src/types.ts`; do not change them. Do not spawn subagents.

Implement `readNotebook(artifact: string, text: string): SourceReadResult`.
This is a pure reader: it must never mutate files, execute code or access a network.
Use strict TypeScript and the existing source-unit contracts.

Requirements:
- Parse nbformat 4 JSON. Invalid JSON, wrong top-level shape, unsupported major
  format or invalid `cells` produce an error diagnostic and no units.
- Identify Python via `metadata.language_info.name` or `metadata.kernelspec.language`
  (case insensitive). If explicit language metadata conflict, or neither identifies
  Python, return an unsupported-language diagnostic and no units. A kernel display
  name alone is not evidence of Python.
- Read only `code` cells. Ignore outputs, execution count, markdown and raw cells.
- `source` may be a string or an array of strings. Concatenate arrays exactly with
  `join('')`, never insert newlines that were absent. Malformed code cells produce
  an error diagnostic with their index; other valid cells can still be read.
- Emit unit kind `cell`, repository-relative artifact as supplied, and original
  zero-based cell index. Preserve non-empty code text including whitespace.
- A valid cell ID is 1-64 characters of ASCII letters, digits, underscores or
  hyphens. If missing, do not fabricate one. Invalid IDs get a warning and are
  treated as missing. IDs duplicated across ANY cells in the notebook are omitted
  from ALL affected code units and get a duplicate-cell-id warning.
- Do not use cell indices as stable IDs. Source cells containing magic commands
  are retained unchanged for the Python parser to report separately.
- Report diagnostics with artifact, severity, code, message and cellIndex when
  relevant. Codes: invalid-notebook, unsupported-language, invalid-cell,
  invalid-cell-id, duplicate-cell-id.

Write tests first using Vitest. Check malformed JSON, missing/contradictory language,
source string/array and Unicode, output/markdown ignoring, missing/invalid/duplicate
IDs, reorder preserving the ID, and input with one invalid and one valid code cell.
Watch the test fail before implementation, then run focused tests and typechecking.
Test runner will be `./scripts/pnpm exec vitest run packages/core/test/notebook.test.ts`.
Dependencies are being installed by the parent; do not install them yourself.

No Git commit: the provided `.git` is externally managed and not a valid repository.
Write your report to `/tmp/citetrace-m0-notebook-report.md`: files, RED/GREEN evidence,
test commands/results and concerns. Return a short completion summary.
