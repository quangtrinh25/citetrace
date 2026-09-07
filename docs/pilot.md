# V0.1 pilot protocol

Status: protocol prepared; no participants recruited and no human results yet.
Alpha artifacts and automated checks do not establish usability or retention.

Recruit5–10 consenting Python/ML researchers for2–4 weeks after the alpha install
and detector quality gates pass. Use their own repositories, including at least
two people working with notebooks. Participation is voluntary. No source code,
paper contents, account identifier or telemetry is collected by the product.

Each participant records their OS, VS Code/Node version and the artifact SHA256.
Give only the quickstart, then ask them to:

1. Install the CLI or VSIX into a fresh environment and open a research project.
2. Add a known paper manually or by DOI/arXiv and inspect the returned metadata.
3. Link it to a function/class or notebook cell, choosing a relationship.
4. Close and reopen the project; locate the linked code and export BibTeX.
5. Review one local suggestion; accept, reject the paper, exempt or ignore it.
6. Move/rename code or reorder cells; identify any review/repair needed.
7. Copy the project with `.citetrace/ledger.json` and repeat locate/export offline.

Record task success, assistance needed, elapsed add-and-link time, errors,
unexpected prompts and whether source files changed. Timing starts when invoking
Add Paper and ends on confirmed link. Record manual/offline and network lookup
times separately so provider latency is visible. Participants choose whether to
share a sanitized reproduction; never require their private source repository.

At the end of week2, ask whether they used CiteTrace again on research work,
whether any source link was useful, and which suggestion was incorrect or noisy.
Do not send reminders or outreach automatically from this repository.

## Release criteria from plan.md

| Measure | Required result | Current evidence |
| --- | --- | --- |
| Participants / duration | 5–10 people, 2–4 weeks | Not run |
| Unassisted core workflow | >=80% participants | Not measured |
| Add-and-link median | <30seconds | Not measured |
| Reuse in week2 | >=50% participants | Not measured |
| Detector evaluation | >=200 labeled cases with independent family/repo split, precision>=90%; scoped recall and paper relevance separately | Development tests exist; independent held-out gate pending |
| Local performance | p95<300ms per unit<1000lines, environment and exclusions disclosed | See benchmark report when generated |

A stable release is blocked until evidence supports these gates. Keep alpha
versioning if the pilot has not run, sample size is too small, or material
correctness/usability issues remain. Fix issues and rerun the affected workflows;
do not reinterpret an automated test pass as a participant success.

## Anonymous result template

Use participant-assigned pseudonyms and aggregate outcomes in the public report.
Keep original notes local unless each participant explicitly permits sharing.

```csv
participant,artifact_sha256,os,editor_version,input_kind,workflow_success,assisted,add_link_seconds,network_mode,source_unchanged,week2_reuse,issue_ids
```

Report missing answers as missing, not failed or successful. Publish denominators,
median with sample size, and limitations. Avoid a stable tag solely because the
calendar reached a milestone.
