# CiteTrace

Never lose the paper behind your code.

CiteTrace records research provenance for Python and Jupyter notebooks. Add a
paper, link it to a function, class, file or cell, find it after moving code, and
export BibTeX. The CLI and VS Code extension share one local core.

**Status: alpha, `0.1.0-alpha.1`.** Paper management, provenance, ten limited
detectors, decisions and the desktop VS Code adapter are implemented. Independent
held-out detector evaluation and a real-user pilot remain pending. This is not a
stable release. [Download the alpha](https://github.com/quangtrinh25/citetrace/releases/tag/v0.1.0-alpha.1).

## Install and use

Download the `.tgz` and `.vsix` from the release above, then install with
`npm install -g ./citetrace-0.1.0-alpha.1.tgz` and
`code --install-extension ./citetrace-0.1.0-alpha.1.vsix`.

To build from source into `dist/release/`:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm exec node scripts/package-release.mjs --smoke
npm install -g ./dist/release/citetrace-0.1.0-alpha.1.tgz
code --install-extension ./dist/release/citetrace-0.1.0-alpha.1.vsix
```

CLI requires Node.js 22.12+; development uses Node.js 24. The extension requires
desktop/remote VS Code 1.95+. JavaScript and WASM are bundled. No Python runtime,
compiler, CiteTrace account or AI service is needed. Verify `SHA256SUMS` beside
the artifacts. The distribution smoke installs the actual tarball offline into
a fresh prefix/cache with normal lifecycle behavior.

Run from your research project:

```bash
citetrace init
citetrace add --title "Layer Normalization" --author "Jimmy Lei Ba" --arxiv 1607.06450
citetrace inspect model.py
citetrace link <paper-id> model.py --symbol Model.normalize --relation uses-method --concept layernorm
citetrace audit --json
citetrace export
```

Use the ID printed by `add` or `papers` and your actual file/symbol. For notebooks,
use `--cell <id>` or a one-based index, optionally with `--symbol`. Indices select
cells but are never their persisted identity. `sync` updates uniquely relocated
unchanged code; `relink` explicitly repairs an edited or ambiguous location.

`add <DOI|arXiv>` fetches metadata explicitly; `--offline` uses cache and `--title`
supports manual entry. `paper update/refresh/remove/merge` manage metadata while
preserving IDs and citation keys. `unlink` removes relationships. See `--help`.

Review suggestions with `decide <suggestion-id> accept`, `ignore`, `exempt --reason
<reason>`, or `reject-paper --paper <candidate-id>`. `decisions` lists stored
decisions; `reopen <decision-id>` makes one available for review again. Rejecting
a paper leaves the concept unresolved. Ignores and exemptions depend on scope and
fingerprint, so meaningful edits can reopen them.

## VS Code

Expand **CiteTrace** in Explorer. Use **Initialize Project**, **Add Paper**,
**Link Paper to Code**, and **Export Bibliography** from the Command Palette.
Python/notebook context menus and sidebar actions support linking, decisions and
repair. Hover shows confirmed paper links. Native notebooks work without a kernel.

Scans run in background workers with a one-second edit debounce and stale-result
cancellation. Dirty buffers are analyzed; save before comparing with CLI audit,
which reads saved files. Unknown notebook language needs explicit **Treat Notebook
as Python for This Session**. This does not rewrite notebook metadata.

Settings: `citetrace.offline` and `citetrace.autoExport`, both default false.
Auto-export follows explicit confirmed link changes. Restricted workspaces support
read-only audit; provenance writes require trust.

## Data and limits

- Commit `.citetrace/ledger.json` with code; ignore `.citetrace/cache/`. Copying
  code and ledger retains links. No source annotations or notebook IDs are added.
- Confirmed means a human declared a relationship, not that origin was proved.
  Metadata source and anchor status are separate. A paper listed at project level
  does not cover every occurrence of a concept.
- Only papers with confirmed links enter `references.citetrace.bib`. User-owned
  files are protected; explicit `export --force` permits replacement. Locks
  coordinate CiteTrace writers; revision checks detect intervening edits. A
  portable filesystem cannot guarantee compare-and-swap against an arbitrary
  noncooperating writer in the final check/rename interval. Avoid editing a
  generated bibliography while exporting.
- Cell IDs, qualified names and structural fingerprints support conservative
  relocation. Duplicates, deletion and uncertain cell edits require relinking.
  There is no Git-history tracking, call graph or semantic proof of equivalence.
- Detectors cover RMSNorm, LayerNorm, BatchNorm, GroupNorm, Focal Loss, Adam,
  AdamW, GELU, RoPE and LoRA using clear names and resolved imported calls. They
  do not infer unnamed formulas or cross-cell execution order. Uncertain lexical
  constructs are conservatively skipped. Candidates need human review; controlled
  development tests do not establish held-out precision.
- Non-Python cells, magic, syntax errors and read failures are reported. Corrupt
  ledgers are never replaced with empty data. Stale locks need human investigation.
- No telemetry or code execution. Network is used only for explicit paper lookup
  or refresh. arXiv throttle reservations coordinate processes sharing one project
  cache, not separate project directories.

## Development

`./scripts/pnpm` uses this workspace's local toolchain; `./scripts/citetrace` runs
the compiled CLI. `.venv` is available for optional Python development helpers.
Run `pnpm check` and `pnpm exec node scripts/benchmark.mjs`. Tests exercise real
WASM parsing, filesystem persistence, compiled CLI, notebook snapshots, cancelled
scans and copied worker bundles. Hosted CI evidence is separate from local tests.

For an offline Python/notebook demo, run `pnpm exec node examples/demo.mjs` after
building. It creates a fresh temporary project, links a clearly fictional demo
reference to both inputs, relocates the Python file and exports BibTeX. Open the
printed project directory in VS Code to explore the resulting ledger and sidebar.
For installation verification in an existing VS Code desktop host, see the
[alpha release notes](docs/release-alpha.md).

[Vietnamese quickstart](docs/quickstart.vi.md) · [Plan](plan.md) ·
[Progress](docs/progress.md) · [Contributing](CONTRIBUTING.md) ·
[Detector guide](docs/detector-contributing.md) · [Pilot](docs/pilot.md)

Licensed under [MIT](LICENSE). Distributions include dependency notices.
