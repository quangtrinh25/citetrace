# CiteTrace — kế hoạch mã nguồn mở đã chốt

> Never lose the paper behind your code.

Bản này thay thế concept ban đầu, được giữ tại `docs/original-plan.md`.
Tiến độ triển khai thực tế: `docs/progress.md`. Người dùng đã chọn ghi nguồn kết
hợp detector giới hạn, và hỗ trợ cả Python `.py` lẫn notebook `.ipynb` ngay bản đầu.

## 1. Mục tiêu và nguyên tắc

CiteTrace giúp người làm nghiên cứu Python/ML ghi paper đứng sau code, tìm lại
nguồn và xem xét những phương pháp có thể chưa được ghi nhận. Phát triển như một
dự án mã nguồn mở trên GitHub; thành công được đo bằng sử dụng thực tế và độ tin cậy.

- VS Code là giao diện chính; CLI dùng chung core TypeScript.
- Không cần tài khoản CiteTrace, backend, GPU hoặc dịch vụ AI.
- Source và notebook không bị chèn annotation hay metadata citation.
- Phân biệt SUGGESTED với CONFIRMED: confirmed là người dùng đã khai báo quan hệ,
  không phải hệ thống đã chứng minh nguồn gốc.
- Metadata paper, xác nhận của người dùng và vị trí code hiện tại là ba khía cạnh riêng.
- Chỉ paper có liên kết được người dùng xác nhận mới vào bibliography.
- Có offline mode; không gửi code hoặc concept tự phát hiện ra mạng.

## 2. V0.1 và trải nghiệm

Vòng sử dụng bắt buộc: mở repo → thêm paper hoặc xem gợi ý → liên kết với code →
lưu/mở lại → tìm đúng vị trí → xuất bibliography.

### Ghi nguồn

Add Paper nhận DOI, arXiv ID/URL hoặc metadata nhập tay; cho người dùng xem metadata
và chọn file, function/class, notebook hoặc cell. Quan hệ: implements, adapted-from,
uses-method, background-reference. Cho phép nhiều paper trên một phạm vi code,
ghi chú và URL repository tham khảo. Paper cấp project không tự cover mọi symbol.
Liên kết file/cell/class chỉ bao phủ con đối với concept đã chọn.

### Detector giới hạn

Danh mục đầu: RMSNorm, LayerNorm, BatchNorm, GroupNorm, Focal Loss, Adam, AdamW,
GELU, RoPE, LoRA. Mỗi mục có alias, paper ứng viên kiểm tra thủ công, tín hiệu AST,
trường hợp dễ nhầm và phiên bản rule. Chỉ xét tên symbol rõ hoặc lời gọi thư viện
có import phân giải được; không cảnh báo vì comment/string/import chưa sử dụng.
Không nhận diện công thức vô danh hoặc xây call graph trong V0.1.

Gợi ý gồm phương pháp, vị trí, bằng chứng và paper ứng viên; không gắn điểm xác suất
chưa hiệu chỉnh. Gộp theo concept và code anchor. Các quyết định khác nhau:

- Xác nhận: lưu liên kết và quan hệ đã chọn.
- Sai paper: loại ứng viên; concept vẫn chưa được giải quyết.
- Không cần ghi nhận: lưu miễn trừ, lý do và phạm vi.
- Bỏ qua: ẩn ở phiên bản code hiện tại; có thể mở lại.

### VS Code và notebook

Sidebar chứa paper, liên kết hiện tại, gợi ý và liên kết cần sửa. Dùng Command Palette,
context menu, hover; mặc định gợi ý ở mức thông tin. Scan lúc mở và sau khoảng 1 giây
ngừng sửa; hủy kết quả cũ, không popup lặp hoặc truy vấn mạng khi gõ.

Notebook: chỉ Python code cell, bỏ qua markdown/output/execution count. Liên kết toàn
cell hoặc symbol trong cell. Không chạy kernel; không thay notebook serializer/controller.
Notebook không xác định được ngôn ngữ cần người dùng xác định Python trước khi phân tích.
Cell có magic/parse lỗi báo phần bỏ qua và vẫn cho phép liên kết thủ công ở cấp cell.
JupyterLab/Colab không có giao diện tích hợp trong V0.1.

### CLI và bibliography

V0.1: init, add, link, unlink, papers, audit, export. Audit đọc dữ liệu đã lưu, hỗ trợ
text/JSON và không sửa repository. M0 có lệnh inspect để kiểm chứng parser và anchors;
inspect chưa phải citation audit.

Export mặc định `references.citetrace.bib`, citation key ổn định, chỉ xuất paper có link
confirmed. Khi bật auto-export, thay đổi liên kết đã xác nhận cập nhật file. Không tự
đè file bibliography người dùng sở hữu. Chưa hiển thị coverage tổng hợp trong V0.1;
hiển thị confirmed, unresolved, exempt và missing links riêng.

## 3. Kiến trúc và dữ liệu

TypeScript strict, pnpm monorepo: core, VS Code adapter, CLI adapter. Core không import
VS Code. Python parser dùng Tree-sitter WASM với grammar đóng gói; không đòi người dùng
cài Python hay compiler. Quét repository ngoài luồng giao diện, tôn trọng gitignore và
loại trừ venv, vendored dependencies, build output, notebook checkpoints.

Core tách reader, parser, detector, provenance, metadata và bibliography. Không thực thi
code của repository. Snapshot của anchor phải JSON-serializable và không chứa source.

`.citetrace/ledger.json` có schema version, Paper, CodeAnchor, ResearchLink, Decision.
Paper có ID nội bộ, DOI/arXiv/version, metadata, citation key và metadata source.
ResearchLink có paper/concept/anchor/relation, người và thời gian xác nhận, ghi chú.
Decision có loại quyết định, phạm vi, fingerprint khi quyết định. Gợi ý tính lại được;
cache và cấu hình riêng máy không commit. Ghi atomic, phát hiện ghi đồng thời; JSON lỗi
hoặc merge conflict phải báo lỗi, không thay bằng ledger rỗng.

Anchor giữ đường dẫn tương đối, qualified symbol và fingerprint cấu trúc. Dòng là gợi ý
hiển thị. Tìm đúng định danh trước; rename/move chỉ theo cấu trúc khi kết quả duy nhất.
Nhiều ứng viên → ambiguous; không thấy → missing; nội dung khác → needs-review.
Background resolution không sửa ledger; Sync Locations ghi thay đổi đã rõ.

Notebook ưu tiên cell ID; không dùng cell index làm định danh. Thiếu ID dùng fingerprint
cell và yêu cầu đối sánh duy nhất; trùng, split hoặc sửa khó nhận diện cần relink.
Không tự chèn ID vào notebook. Cross-file relocation cũng phải duy nhất và có bằng chứng.

DOI dùng content negotiation; arXiv dùng metadata API. Có timeout, retry hữu hạn, cache,
provider throttling và nhập tay khi lỗi/offline. Chỉ mạng khi thêm/refresh paper. Không
gộp paper theo title giống nhau; giữ phiên bản và cho phép người dùng hợp nhất.

## 4. Milestones và GitHub

| Mốc | Bàn giao | Điều kiện chuyển |
| --- | --- | --- |
| M0 | Môi trường, parser `.py`/`.ipynb`, anchors, CLI inspect | Rename/reorder/duplicate được resolve đúng hoặc báo mơ hồ |
| M1 | Ledger và CLI ghi nguồn, metadata, export | Copy/clone sang máy khác vẫn đọc và xuất được |
| M2 | VS Code và notebook UX | Thêm paper → link → export không sửa JSON thủ công |
| M3 | 10 detector và quản lý quyết định | Gợi ý đạt tiêu chí chất lượng, không hỏi lại liên tục |
| M4 | GitHub public alpha: VSIX, CLI package, demo | Cài artifact trên môi trường sạch |
| M5 | V0.1 ổn định sau pilot | Đạt các tiêu chí dưới đây |

M0 kiểm chứng rủi ro trước khi làm đầy đủ UI. Một maintainer chính; đóng góp cộng đồng
không nằm trên đường phụ thuộc để hoàn thành bản đầu. MIT cho code; README/contributing
bằng tiếng Anh, quickstart tiếng Việt. GitHub Issues theo milestone; có hướng dẫn thêm
rule, changelog, giới hạn và demo cả Python/notebook. GitHub Release trước; Marketplace
và npm registry sau pilot. CI của CiteTrace build, typecheck, test và kiểm artifact;
GitHub Action cho repository người dùng là tính năng sau.

V0.2: Git-aware audit, lịch sử và CiteTrace Blame.
V0.3: GitHub Action, job summary; không block merge vì gợi ý mặc định.
V0.4: mở rộng registry, tìm paper theo yêu cầu.
AI, ngôn ngữ khác và editor khác chỉ lập kế hoạch riêng sau dữ liệu sử dụng thực tế.

## 5. Nghiệm thu

- CRUD/export không trùng ID/citation key; chỉ confirmed vào bibliography.
- Restart/clone/đổi máy giữ dữ liệu; rename/move/delete/branch-switch không âm thầm gắn sai.
- Notebook có/không ID, reorder/duplicate/split/delete cell và source string/array được kiểm tra.
- CLI/VS Code tương đương với cùng nội dung đã lưu; parse lỗi không suy diễn thành scan đầy đủ.
- API timeout/429/offline, ledger lỗi và ghi đồng thời không mất dữ liệu.
- Ít nhất 200 mẫu gán nhãn cho 10 detector, cân bằng positive/hard-negative; chia train/eval
  theo repository hoặc họ implementation. Precision concept ≥90% trên tập giữ lại; công bố
  recall trong phạm vi hỗ trợ và đánh giá mức liên quan paper riêng.
- Pilot 5–10 người trong 2–4 tuần; ≥80% hoàn thành workflow không hướng dẫn trực tiếp;
  trung vị thêm/link paper <30 giây khi mạng bình thường; ≥50% dùng lại tuần sau.
- Mục tiêu p95 phân tích local <300ms cho đơn vị <1000 dòng, ghi cấu hình máy, không tính
  debounce/mạng. Không có lỗi mất ledger hoặc gắn nhầm trong bộ test bắt buộc.
- Không telemetry mặc định; phản hồi tự nguyện qua GitHub. Nếu chưa đạt thì sửa workflow,
  anchors và rules trước khi tăng phạm vi.
