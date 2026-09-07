# CiteTrace alpha

Keep the paper behind your Python code and notebooks. Provenance stays in
`.citetrace/ledger.json` inside the project. The extension does not execute code,
start a kernel, annotate source files, send source over the network, or collect
telemetry. It works with VS Code's existing notebook editor.

Open a local folder and expand **CiteTrace** in Explorer. Use the Command Palette:

1. **CiteTrace: Initialize Project**.
2. **CiteTrace: Add Paper** — manually or by DOI/arXiv; review metadata.
3. Open a Python file or notebook cell, then **CiteTrace: Link Paper to Code**.
   Choose file/cell/symbol, paper, relationship and an optional detector concept.
4. **CiteTrace: Export Bibliography** creates `references.citetrace.bib`.

Right-click suggestions to accept, ignore, exempt with a reason, or reject their
paper candidate. Rejecting a paper leaves the concept unresolved. Reopen stored
decisions from the sidebar. Broken links can be relinked; Sync Locations updates
unambiguous unchanged code that moved. Links are human attestations, not proof.

Scans run in background workers, with a one-second edit debounce and cancellation
of stale results. Dirty editor content is analyzed; save source before copying
the project or comparing with CLI audit, which reads saved files. Unknown notebook
language needs explicit **Treat Notebook as Python for This Session**; this never
rewrites the notebook. Non-Python cells and unsupported syntax are reported.

Settings: `citetrace.offline` uses cache/manual metadata;
`citetrace.autoExport` defaults to false and exports only after explicit confirmed
link changes. User-owned bibliographies are protected from automatic replacement.
Read-only audit works in restricted workspaces; trust is required for writes.

This is an alpha. The ten limited detectors use names and resolved library calls;
they do not infer arbitrary formulas, trace a call graph, or infer cross-cell
execution order. Paper candidates need human review. Independent held-out quality
evaluation and the real-user pilot remain release gates. No Marketplace publishing
or account registration is needed to install a locally built VSIX.
