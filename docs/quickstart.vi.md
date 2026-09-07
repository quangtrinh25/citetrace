# Dùng thử CiteTrace alpha

CiteTrace lưu paper đứng sau Python/notebook trong `.citetrace/ledger.json`.
Không chạy code, không chèn comment vào source, không cần tài khoản hay AI.
Đây là bản GitHub alpha; đánh giá detector độc lập và pilot người dùng vẫn còn phải làm.

## Cài và chạy

Tải `.tgz` và `.vsix` tại [GitHub Release](https://github.com/quangtrinh25/citetrace/releases/tag/v0.1.0-alpha.1),
rồi dùng `npm install -g <file.tgz>` và `code --install-extension <file.vsix>`.

Để tự build trong workspace này:

```bash
./scripts/pnpm check
./scripts/pnpm exec node scripts/package-release.mjs --smoke
npm install -g ./dist/release/citetrace-0.1.0-alpha.1.tgz
code --install-extension ./dist/release/citetrace-0.1.0-alpha.1.vsix
```

CLI cần Node.js 22.12+, extension cần VS Code desktop/remote 1.95+. Parser WASM
đã đóng gói; người dùng không cần Python/compiler. `.venv` đã tạo chỉ phục vụ
phát triển tùy chọn. Có thể dùng `./scripts/citetrace` trong workspace thay vì cài CLI.

Trong project nghiên cứu:

```bash
citetrace init
citetrace add --title "Layer Normalization" --author "Jimmy Lei Ba" --arxiv 1607.06450
citetrace inspect model.py
citetrace link <paper-id> model.py --symbol Model.normalize --relation uses-method --concept layernorm
citetrace audit --json
citetrace export
```

Thay `<paper-id>` bằng ID từ `add`/`papers`, thay file và symbol bằng code thực tế.
Notebook dùng `--cell <id>` hoặc số cell từ 1, thêm `--symbol` để chọn hàm bên trong.
Có thể liên kết cả cell khi cell có magic không phân tích được.

Demo offline có sẵn: chạy `./scripts/pnpm exec node examples/demo.mjs` sau khi
build. Script tạo project tạm mới, gắn một tài liệu giả lập vào Python và notebook,
chuyển file Python rồi xuất BibTeX. Mở thư mục được in ra bằng VS Code để xem sidebar.

Quan hệ: `implements`, `adapted-from`, `uses-method`, `background-reference`.
Confirmed nghĩa là bạn khai báo quan hệ, không phải hệ thống chứng minh nguồn gốc.
Chỉ paper có link confirmed được xuất BibTeX. Paper trong danh sách chưa tự phủ
mọi chỗ sử dụng cùng phương pháp.

`add <DOI|arXiv>` tra metadata theo yêu cầu; `--offline` dùng cache. Dùng `--title`
để nhập thủ công hoàn toàn offline. `paper update/refresh/remove/merge` quản lý
paper; `unlink` xóa link, `sync` cập nhật chỗ chuyển rõ ràng, `relink` chọn lại code.
Xem `citetrace --help` để biết tham số.

## Trong VS Code

Mở project và mục **CiteTrace** trong Explorer, rồi dùng Command Palette:

1. **Initialize Project**.
2. **Add Paper**, xem metadata rồi thêm.
3. Mở Python/cell notebook, dùng **Link Paper to Code**.
4. Chọn scope, paper, quan hệ và concept nếu cần.
5. **Export Bibliography** mở BibTeX vừa sinh.

Chuột phải gợi ý để xác nhận, bỏ qua, miễn trừ có lý do hoặc loại paper sai. Loại
paper không giải quyết concept. Mở lại từ Decisions; Needs Attention chứa link
cần sửa. Hover trên code giúp tìm paper đã gắn.

VS Code phân tích nội dung đang sửa sau khoảng 1 giây ngừng gõ; CLI đọc file đã lưu.
Lưu trước khi đối chiếu hoặc copy project. Notebook chưa rõ ngôn ngữ dùng **Treat
Notebook as Python for This Session**; không ghi lại metadata và không chạy kernel.

Commit/copy ledger cùng code, bỏ qua cache. `citetrace.autoExport` mặc định tắt;
bật để xuất sau khi sửa link confirmed. Không chỉnh tay file đã sinh lúc đang
export. Chỉ dùng `export --force` nếu chủ động muốn thay file BibTeX tự viết.

Detector có phạm vi giới hạn và cần người xem lại paper. Code/cell trùng hoặc
thay đổi khó nhận diện sẽ báo ambiguous/missing/needs-review. Pilot 5–10 người,
2–4 tuần và đánh giá trên repo độc lập vẫn là điều kiện trước stable.
Xem [tiến độ](progress.md) và [quy trình pilot](pilot.md).
