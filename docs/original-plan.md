# CiteTrace

> A background citation tracker for research-driven code.

## 1. Mục tiêu

CiteTrace chạy nền trong VS Code và repository.

Nó phải giải quyết một việc:

**Khi code sử dụng thuật toán, kiến trúc, loss, preprocessing method, statistical method hoặc ý tưởng bắt nguồn từ paper, CiteTrace giúp ghi lại paper đó và cảnh báo nếu project có khả năng quên citation.**

Workflow cuối:

```text
Developer code
      ↓
CiteTrace theo dõi thay đổi
      ↓
Phát hiện concept/method
      ↓
Đối chiếu citation ledger
      ↓
Có citation → OK
Không có → tìm paper ứng viên
      ↓
Developer xác nhận
      ↓
paper → concept → code được lưu
      ↓
references.bib tự cập nhật
```

---

# 2. Nguyên tắc thiết kế

CiteTrace phải phân biệt hai loại provenance.

### CONFIRMED

Developer xác nhận:

```text
Paper X
→ Selective State Space
→ src/models/mamba.py
```

Đây là provenance đáng tin cậy.

### SUGGESTED

CiteTrace suy luận:

```text
src/models/norm.py
→ có vẻ sử dụng RMSNorm
→ possible source: RMSNorm paper
```

Không bao giờ tự biến suggestion thành citation chính thức.

Developer phải Accept / Reject.

Điều này tránh tạo citation sai.

---

# 3. Sản phẩm cuối cùng

CiteTrace gồm ba thành phần:

```text
                 CiteTrace Core
                      │
        ┌─────────────┼──────────────┐
        │             │              │
        ▼             ▼              ▼
 VS Code Extension    CLI       GitHub Action
```

## VS Code Extension

Interface chính.

Chạy nền khi developer code.

Ví dụ sidebar:

```text
CITETRACE

PROJECT
✓ 17 papers
✓ 24 code links
⚠ 3 possible missing citations

CURRENT FILE
src/models/model.py

✓ Mamba
  Selective State Space
  Gu & Dao, 2023

⚠ RMSNorm
  Citation not confirmed
```

---

# 4. UX quan trọng nhất

Developer không nên phải viết annotation vào source code.

Không:

```python
@citation(...)
def selective_scan():
```

Mà CiteTrace lưu metadata riêng.

Ví dụ:

```text
.citetrace/
├── papers.json
├── links.jsonl
├── config.json
└── cache/
```

Source code vẫn sạch.

---

# 5. Citation Ledger

Một record:

```json
{
  "paper_id": "arxiv:2312.00752",
  "title": "Mamba: Linear-Time Sequence Modeling with Selective State Spaces",
  "concept": "selective state-space mechanism",
  "relation": "adapted-from",
  "artifact": "src/models/mamba.py",
  "symbol": "SelectiveSSM",
  "commit": "91ac33f",
  "status": "confirmed",
  "added_by": "developer"
}
```

CiteTrace không chỉ biết:

```text
project → paper
```

mà biết:

```text
paper
↓
concept
↓
file
↓
function/class
↓
commit
```

Đây là core data model của toàn bộ project.

---

# 6. Workflow A — developer biết paper

Developer đang đọc paper và bắt đầu implement.

Command Palette:

```text
CiteTrace: Add Paper
```

Paste:

```text
https://arxiv.org/abs/2312.00752
```

CiteTrace resolve:

```text
Mamba: Linear-Time Sequence Modeling...
Gu & Dao
2023
arXiv:2312.00752
```

Developer chọn:

```text
Link to current function
```

→ xong.

Không cần tự viết BibTeX.

---

# 7. Workflow B — developer quên citation

Developer viết:

```python
class RMSNorm(nn.Module):
    ...
```

CiteTrace phân tích code.

Phát hiện concept:

```text
Root Mean Square normalization
```

Citation ledger:

```text
Không tồn tại paper tương ứng.
```

Extension hiển thị:

```text
Possible missing citation

RMS Normalization

Possible source:
Root Mean Square Layer Normalization
Zhang & Sennrich

[Add]
[Not derived]
[Ignore]
```

---

# 8. Workflow C — GitHub PR

VS Code là lớp phát hiện sớm.

GitHub Action là lớp kiểm tra cuối.

```text
git push
   ↓
Pull Request
   ↓
CiteTrace Action
   ↓
git diff
   ↓
citation audit
```

PR Check:

```text
CiteTrace Citation Audit

✓ 21 confirmed research links
✓ 14 papers verified

⚠ 2 possible missing citations

src/models/norm.py:24
Possible RMSNorm implementation

src/losses/focal.py:17
Possible Focal Loss implementation
```

Điều này giúp team không merge code mà quên provenance.

---

# 9. Architecture

Nên dùng monorepo TypeScript:

```text
citetrace/
│
├── packages/
│   ├── core/
│   │   ├── scanner/
│   │   ├── matcher/
│   │   ├── provenance/
│   │   ├── metadata/
│   │   └── bibliography/
│   │
│   ├── vscode/
│   │
│   ├── cli/
│   │
│   └── github-action/
│
├── .github/
│
├── tests/
│
└── docs/
```

### Tại sao TypeScript?

VS Code extension native dùng TypeScript/Node.

Nếu core cũng TypeScript:

```text
VSCode Extension
CLI
GitHub Action
```

có thể cùng dùng:

```text
@citetrace/core
```

Không bắt user cài Python riêng.

---

# 10. Paper metadata

Input hỗ trợ:

```text
DOI
arXiv URL
arXiv ID
paper title
BibTeX
```

Pipeline:

```text
input
 ↓
identifier resolver
 ↓
metadata provider
 ↓
canonical paper
```

Nguồn:

```text
Crossref
OpenAlex
arXiv
Semantic Scholar
```

Không phụ thuộc một provider duy nhất.

---

# 11. Code analysis

Không gửi toàn bộ repository lên AI ngay từ đầu.

### Level 1 — deterministic

Phân tích:

```text
imports
class names
function names
comments
docstrings
identifiers
dependencies
```

Ví dụ:

```python
class FocalLoss
class RMSNorm
class MambaBlock
```

đã là signal rất mạnh.

---

### Level 2 — AST

Dùng Tree-sitter.

Extract:

```text
function
class
method
call graph
changed symbol
```

Thay vì scan cả file.

---

### Level 3 — semantic matcher

Representation:

```text
Code concept
        ↕
Paper title
Paper abstract
Paper keywords
```

Similarity search sinh candidate papers.

---

### Level 4 — reasoning

Chỉ dùng khi ambiguity cao.

Ví dụ code không có tên `RMSNorm` nhưng implementation:

```text
x / sqrt(mean(x²) + eps)
```

CiteTrace có thể suy luận:

```text
possible RMS normalization
```

---

# 12. Không scan internet mỗi lần gõ

Sai kiến trúc nếu:

```text
keypress
→ API
→ search paper
```

Quá chậm và tốn API.

Thay vào đó:

```text
editing
↓
debounce
↓
local analysis
↓
concept candidate
↓
local paper cache
↓
chỉ search scholarly API nếu cần
```

---

# 13. Local-first

Default:

```text
source code stays local
```

Chỉ gửi:

```text
concept query
paper metadata query
```

ra scholarly API.

AI semantic analysis bên ngoài phải là:

```text
opt-in
```

Điều này rất quan trọng với:

* unpublished research;
* proprietary R&D;
* startup code;
* private repositories.

---

# 14. MVP — V0.1

Không làm AI ngay.

Support trước:

```text
Python
```

Features:

* VS Code extension
* `.citetrace/`
* Add paper
* DOI/arXiv resolver
* Link paper → file
* Link paper → function/class
* unlink
* list citations
* export BibTeX
* citation sidebar
* repository persistence

Acceptance test:

```text
clone repo
↓
install extension
↓
add Mamba paper
↓
link SelectiveSSM()
↓
restart VS Code
↓
link vẫn tồn tại
↓
references.bib sinh đúng
```

---

# 15. V0.2 — Git awareness

Thêm:

```text
git diff
git commit
git blame
```

Ledger bắt đầu lưu:

```text
introduced_at
last_modified_at
commit
```

Command:

```text
CiteTrace: Show Research History
```

Ví dụ:

```text
SelectiveSSM

introduced:
commit a7812e

research sources:
Mamba — Gu & Dao
S4 — Gu et al.
```

---

# 16. V0.3 — Passive Detection

Bắt đầu chạy nền.

Pipeline:

```text
changed code
↓
extract symbol
↓
concept classifier
↓
project citation lookup
↓
warning
```

Đầu tiên chỉ support các pattern rõ:

```text
architectures
loss functions
normalization
optimizers
feature extraction
signal processing
statistical methods
```

---

# 17. V0.4 — Paper Discovery

Nếu concept chưa tồn tại:

```text
concept
↓
OpenAlex / Semantic Scholar
↓
candidate papers
↓
ranking
```

Output:

```text
Possible origin

0.92  Focal Loss for Dense Object Detection
0.61  RetinaNet
0.34  ...
```

Developer quyết định.

---

# 18. V0.5 — GitHub Action

File:

```text
.github/workflows/citetrace.yml
```

PR:

```text
Citation Coverage: 92%

Confirmed: 23
Possible missing: 2
Unresolved: 1
```

Không block merge mặc định.

Có config:

```json
{
  "failOnMissing": false
}
```

Sau này team có thể bật:

```json
{
  "failOnMissing": true
}
```

---

# 19. V0.6 — VS Code diagnostics

Hiển thị tương tự linter.

Ví dụ dưới function:

```text
⚠ Possible missing research citation
```

Hover:

```text
Possible method: Focal Loss

Candidate:
Lin et al., 2017

Confidence: 0.91
```

---

# 20. V1.0

Target:

### Languages

```text
Python
C++
R
Julia
MATLAB
```

Ưu tiên Python trước vì scientific/ML ecosystem.

### Features

```text
✓ VS Code Extension
✓ CLI
✓ GitHub Action
✓ paper resolver
✓ provenance ledger
✓ code-level citations
✓ semantic detection
✓ candidate paper search
✓ BibTeX export
✓ CITATION.cff export
✓ PR audit
✓ citation coverage
```

---

# 21. Feature quan trọng: CiteTrace Blame

Command:

```bash
citetrace blame src/models/model.py
```

Output:

```text
src/models/model.py

L22-L58
SelectiveSSM

Research lineage:

Mamba
└── selective state-space mechanism

S4
└── state-space formulation
```

Đây có thể trở thành signature feature.

Concept:

> `git blame`, nhưng blame nguồn gốc học thuật.

---

# 22. Citation Coverage

CiteTrace có thể có metric:

```text
Research Citation Coverage
```

Ví dụ:

```text
Research concepts detected: 18

Confirmed citation: 14
Rejected:            2
Unresolved:          2

Coverage: 87.5%
```

Nhưng phải ghi rõ đây là:

```text
detected-concept coverage
```

không phải:

> “87.5% toàn bộ citation thực sự của project”.

Không thể chứng minh absolute completeness.

---

# 23. False positive management

Đây sẽ là vấn đề khó nhất của sản phẩm.

Mỗi suggestion phải có:

```text
Accept
Reject
Ignore
```

Nếu Reject:

```json
{
  "concept": "RMSNorm",
  "artifact": "...",
  "decision": "not-derived"
}
```

CiteTrace không hỏi lại liên tục.

---

# 24. Không tự động thêm citation

Rule:

```text
AI suggestion ≠ citation
```

Chỉ:

```text
developer confirmation → confirmed citation
```

Nếu không, bibliography có thể chứa paper mà developer chưa từng sử dụng.

---

# 25. Repository public

README nên cực đơn giản:

```text
# CiteTrace

Never lose the paper behind your code.

CiteTrace tracks research provenance inside your codebase
and warns when an implementation may be missing its academic source.
```

Demo GIF:

```text
write RMSNorm
↓
warning xuất hiện
↓
paper được đề xuất
↓
Accept
↓
references.bib updated
```

Đây sẽ giải thích sản phẩm tốt hơn hàng nghìn chữ.

---

# 26. Distribution

Ba cách:

### VS Code Marketplace

Primary.

```text
Extensions
→ CiteTrace
→ Install
```

### GitHub

Source + releases.

```bash
git clone ...
```

### npm

CLI:

```bash
npm install -g citetrace
```

sau đó:

```bash
citetrace init
citetrace audit
citetrace papers
citetrace export
```

---

# 27. Roadmap ưu tiên

```text
PHASE 1
Core provenance model
      ↓
PHASE 2
VS Code Extension
      ↓
PHASE 3
Paper metadata resolver
      ↓
PHASE 4
BibTeX generation
      ↓
PHASE 5
Git integration
      ↓
PHASE 6
Passive code detection
      ↓
PHASE 7
Paper candidate search
      ↓
PHASE 8
GitHub Action
      ↓
PHASE 9
Semantic/AI detection
      ↓
PHASE 10
Multi-language
```

Không đảo thứ tự.

Đặc biệt:

```text
AI
```

phải đến **sau khi provenance core hoạt động tốt**.

---

# 28. Definition of Done cho V1

Một developer mới phải có thể:

```text
1. Install CiteTrace từ VS Code
2. Open repository
3. CiteTrace tự init
4. Code như bình thường
5. Nhận missing-citation warning
6. Accept candidate paper
7. Paper được link với function
8. Commit
9. Push GitHub
10. PR được citation audit
11. Export references.bib
```

Không cần đọc documentation dài.

---

# 29. Những thứ KHÔNG build ban đầu

Không làm:

```text
❌ reference manager kiểu Zotero
❌ PDF reader
❌ literature review
❌ paper summarizer
❌ PDF annotation
❌ LaTeX editor
❌ research chatbot
❌ paper recommendation feed
```

Những thứ này khiến project mất focus.

CiteTrace chỉ làm:

```text
CODE ↔ RESEARCH SOURCE
```

---

# 30. Product identity

Tên tạm:

```text
CiteTrace
```

Concept:

> **Never lose the paper behind your code.**

Core mental model:

```text
ESLint → code quality
Git → code history
CiteTrace → research provenance
```

Đây nên là phạm vi sản phẩm giữ nguyên ít nhất đến V1.
