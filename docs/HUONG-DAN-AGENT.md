# Hướng dẫn: xây dựng Cab Booking System bằng Claude Code + 3 subagent

Áp dụng mẫu bài tập của giảng viên (API Gateway + AuthService + CustomerService, làm bằng Agent BA, Agent Dev, Agent Test) vào project CAB.

## 1. Bốn file cấu hình

| File | Ai đọc | Chứa gì |
|---|---|---|
| `CLAUDE.md` | Claude Code và cả 3 agent, tự nạp mỗi phiên | Tài liệu nguồn, quy tắc kiến trúc theo yêu cầu giảng viên, quyết định nghiệp vụ đã chốt, trạng thái code, quy ước code |
| `.claude/agents/ba-agent.md` | Agent BA | Viết đặc tả vào `docs/specs/`, giữ `srs.md` ↔ DDD ↔ API document nhất quán |
| `.claude/agents/dev-agent.md` | Agent Dev | Code theo đặc tả: proto, service, migration, Docker, Kafka |
| `.claude/agents/test-agent.md` | Agent Test | Viết và chạy test, Postman, báo cáo |

Mỗi file agent mở đầu bằng frontmatter:

```yaml
---
name: ba-agent                      # tên để gọi
description: ... Dùng khi ...       # Claude dựa vào đây để biết khi nào giao việc
tools: Read, Glob, Grep, Write, Edit  # công cụ được phép dùng
---
```

Phần dưới frontmatter là lời hướng dẫn riêng của agent đó.

**Phân quyền giữa các agent** (ai được ghi vào đâu):

| | `srs.md`, DDD, `API document/`, `docs/specs/` | `proto/`, `services/`, `compose.yaml` | `tests/`, `postman/`, `docs/test-reports/` | Chạy lệnh |
|---|---|---|---|---|
| ba-agent | ✅ | ❌ | ❌ | ❌ (không có Bash) |
| dev-agent | ❌ | ✅ | ❌ | ✅ |
| test-agent | ❌ | ❌ | ✅ | ✅ |

Tách như vậy để BA không tự code, Dev không tự sửa yêu cầu cho khớp code, Test không tự sửa code cho test xanh.

## 2. Chuẩn bị

Agent được nạp khi Claude Code khởi động. Sau khi tạo hoặc sửa file agent, mở lại Claude Code trong thư mục project:

```bash
cd "E:\HK7 IUH\MSA\cab-system-project"
claude
```

Gõ `/agents`. Phải thấy `ba-agent`, `dev-agent`, `test-agent`.

## 3. Một vòng làm việc

```
        ┌──────────┐  đặc tả   ┌───────────┐   code    ┌────────────┐
 mục ──►│ ba-agent │──────────►│ dev-agent │──────────►│ test-agent │──► báo cáo
 chấm   └──────────┘           └───────────┘           └────────────┘
              ▲                      ▲     lỗi cần sửa        │
              │ yêu cầu chưa rõ      └────────────────────────┘
              └──────────────────────────────────────────────┘
```

Ba prompt mẫu, thay phần trong `< >`:

```
Dùng ba-agent viết đặc tả cho mục chấm <số>: <tên mục>, ghi vào docs/specs/.
```

```
Dùng dev-agent hiện thực đặc tả docs/specs/<tên file>.
```

```
Dùng test-agent viết và chạy test cho docs/specs/<tên file>, tạo request Postman
cho mục chấm <số>, và ghi báo cáo vào docs/test-reports/.
```

Khi test đỏ:

```
Dùng dev-agent sửa các lỗi trong docs/test-reports/<tên file báo cáo>.
```

Sau mỗi bước, **bạn tự đọc kết quả trước khi đi tiếp**: đọc đặc tả của BA và tự trả lời được "vì sao" cho từng quyết định; chạy lại `npm test`; thử lại bằng Postman.

## 4. Lộ trình theo phiếu chấm

Mỗi vòng là một lượt BA → Dev → Test. Làm theo thứ tự vì vòng sau dùng kết quả vòng trước.

| Vòng | Nội dung | Mục chấm | Service |
|---|---|---|---|
| 1 | Rà kiến trúc: bảng "đường giao tiếp ↔ nghiệp vụ", danh sách topic Kafka kèm publisher/subscriber và lý do; vẽ lại sơ đồ | 3, 4 | Toàn hệ thống (chỉ BA) |
| 2 | Hạ tầng: `package.json` + Dockerfile riêng từng service, Compose đủ container, Kafka + Kafka UI, `/ready` ở Gateway, chỉ Gateway mở cổng | 1, 2, 5, 6, 7, 8 | Gateway, Identity |
| 3 | Đăng nhập, cấp JWT; Gateway kiểm tra chữ ký token | 9, 10, 25, 27 | Identity, Gateway |
| 4 | Phân quyền theo role, rate limit; xem khách hàng theo mã | 11, 28, 29 | Gateway, Identity |
| 5 | Tài xế: đăng ký (OTP), Admin duyệt, Online/Offline, xem tài xế, tài xế trong 1 km | 21, 22, 23, 12, 13 | Fleet |
| 6 | Đặt xe, ghép tài xế, tài xế nhận chuyến, danh sách booking | 15, 16, 14 | Booking, Dispatch, Notification |
| 7 | Trạng thái chuyến, hủy chuyến | 17, 18 | Trip, Notification |
| 8 | Thanh toán online, chống gửi lặp | 19, 30 | Payment |
| 9 | Đánh giá chuyến | 20 | Rating |
| 10 | Mã hóa dữ liệu nhạy cảm, chống XSS; rà lại cả 30 mục | 24, 26 | Mọi service |

### Prompt cho vòng 1 (chỉ BA, chưa code)

```
Dùng ba-agent rà lại kiến trúc giao tiếp của toàn hệ thống theo quy tắc trong CLAUDE.md.
Viết docs/specs/00-kien-truc-giao-tiep.md gồm: bảng mọi lời gọi gRPC và mọi event Kafka,
mỗi dòng ghi bên gửi, bên nhận, đồng bộ hay bất đồng bộ, và FR/BRULE/NFR cần nó;
loại bỏ những đường không có lý do nghiệp vụ; cập nhật mục 10 của tài liệu DDD cho khớp.
```

### Prompt cho vòng 3 (ví dụ một vòng đầy đủ)

```
Dùng ba-agent viết đặc tả cho mục chấm 10: đăng nhập khách hàng và cấp token,
kèm phần Gateway kiểm tra chữ ký JWT (mục chấm 27), ghi vào docs/specs/10-dang-nhap.md.
```

```
Dùng dev-agent hiện thực đặc tả docs/specs/10-dang-nhap.md.
```

```
Dùng test-agent viết và chạy test cho docs/specs/10-dang-nhap.md, tạo request Postman
cho mục chấm 9, 10, 25, 27, và ghi báo cáo vào docs/test-reports/.
```

## 5. Nguyên tắc

1. **Một prompt, một agent, một phần việc.** Phần việc càng hẹp, kết quả càng dễ kiểm tra.
2. **BA trước, luôn luôn.** Không có đặc tả thì Dev không code. Yêu cầu đổi thì sửa đặc tả trước.
3. **Agent báo "xong" chưa phải là xong.** Tự chạy lại test và Postman.
4. **Commit sau mỗi vòng xanh** để quay lại được khi vòng sau hỏng.
5. **Bạn là người vấn đáp.** Mỗi vòng xong, tự trả lời: service này vì sao dùng database này, vì sao gọi đồng bộ hay bất đồng bộ, mỗi kiểu dữ liệu vì sao chọn. Không trả lời được thì hỏi lại trước khi sang vòng sau.
