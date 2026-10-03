# ADR-015 — Khóa chính số nguyên (`bigint` identity), không dùng UUID

- Ngày: 2026-10-03. Trạng thái: **Đã chấp nhận** — sinh viên chốt theo luật thi, ghi trong `CLAUDE.md` dòng "Khóa chính". Chi tiết `START WITH 1000` và mã seed số nhỏ là BA đề xuất.
- Thay cho: quy ước UUID của bản thiết kế 2026-10-02 (Q31 cũ).
- Liên quan: `docs/design/03-du-lieu.md` mục 2, 6.1, 14; `docs/design/02` mục 6.1; `docs/design/01` Q31; mọi API theo mã ở `docs/design/04`; mục chấm 11, 12, 14, 16–20, 22, 30.

## Bối cảnh

Luật thi (2026-10-03): Postman **không lưu sẵn gì**, mọi request gõ tay; chỉ được copy giá trị từ response trước; không mở tài liệu. Mỗi mục chấm khoảng 30 giây. Phiếu chấm viết "lấy thông tin … với **mã số**". Thiết kế tham chiếu đã duyệt dùng `INT`.

## Các lựa chọn

| # | Lựa chọn | Ưu | Nhược |
|---|---|---|---|
| A | UUID (`gen_random_uuid()`) | Không đoán được; service tự sinh mã trước khi ghi | 36 ký tự, không gõ tay được, không học thuộc được mã seed |
| B | **`bigint GENERATED ALWAYS AS IDENTITY`** | `/api/v1/customers/1` — phần mã gõ trong một giây; mã seed học thuộc được; giống tham chiếu | Mã dễ đoán; mã chỉ có sau khi database cấp |
| C | `serial` / `integer` | Như B | `serial` là cách cũ, cho ghi đè ID nhầm; `integer` không khác biệt gì đáng kể nhưng `CLAUDE.md` đã chốt `bigint` |

## Quyết định

Chọn **B** cho mọi bảng có mã tự cấp.

| Điểm | Thiết kế |
|---|---|
| Mã do API tạo | `START WITH 1000` → luôn ≥ 1000 |
| Mã seed | Số nhỏ theo quy luật (khách 1–3, 9; tài xế 11–18; admin 99; booking = payment = trip 1–7), ghi bằng `OVERRIDING SYSTEM VALUE` → không bao giờ trùng mã API |
| Hồ sơ khách, hồ sơ tài xế, `driver_ratings` | PK **không** identity: bằng `account_id` / `driver_id` |
| Booking cần mã trước khi gọi S4 | Lấy số bằng `nextval(pg_get_serial_sequence('bookings','booking_id'))`, gọi S4, rồi `INSERT … OVERRIDING SYSTEM VALUE` |
| Ra khỏi database | `pg` đọc `bigint` thành số (`types.setTypeParser(20, Number)`); proto `int64` với `longs: Number`; JSON trả số |
| Không đổi | `event_id` của event Kafka vẫn là UUID do bên phát sinh (không ai gõ); `_id` của MongoDB là ObjectId (không có API theo mã thông báo) |

## Vì sao

1. Gõ tay được: mã ngắn là điều kiện để mỗi mục chấm làm xong trong 30 giây.
2. Học thuộc được: mã seed theo quy luật, nhìn số điện thoại là biết mã.
3. Khớp phiếu chấm ("mã số") và thiết kế tham chiếu đã duyệt.
4. Mỗi service tự cấp số cho bảng của mình; không cần nơi cấp số chung vì không có khóa ngoại giữa service.

## Đánh đổi

- **Mã dễ đoán**: đổi `/api/v1/customers/1` thành `/api/v1/customers/2` là thử được dữ liệu người khác. Vì vậy **mọi API theo mã kiểm tra quyền sở hữu** và trả 403 (`docs/design/04` mục 4) — điều này phải làm dù dùng UUID.
- Mã lộ quy mô (biết đã có khoảng bao nhiêu booking). Chấp nhận cho môi trường học tập.
- Service không tự sinh mã trước khi ghi như UUID: Booking phải xin số từ dãy trước khi gọi Payment; số bị bỏ khi S4 lỗi (dãy có lỗ, vô hại).
- Mã của hai service có thể trùng giá trị (booking 7 và trip 7). Không gây lỗi vì không bảng nào trộn mã của hai service; seed còn cố ý cho trùng để dễ nhớ.

## Câu trả lời mẫu khi vấn đáp

"Em dùng khóa chính số nguyên tự tăng, kiểu bigint identity, vì khi thi phải gõ tay mọi request: gõ `/api/v1/customers/1` thì nhanh, UUID 36 ký tự thì không. Mã do API tạo bắt đầu từ 1000, còn dữ liệu mẫu dùng số nhỏ nên không bao giờ trùng. Nhược điểm là mã dễ đoán, nên mọi API theo mã đều kiểm tra người gọi có phải chủ dữ liệu không, sai thì trả 403."

## Điều kiện xem lại

Hệ thống mở ra Internet thật, hoặc cần sinh mã ở nhiều nơi trước khi ghi database.
