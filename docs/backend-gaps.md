# Những chỗ FE đang phải lách vì backend chưa có

Ghi nhận khi dựng `callbot-web-client` lên ngang UX luồng AutoCall của OMICRM (2026-08-06).
Nguồn đối chiếu: router + controller + service của `cloud-vihat-saas-omicrm-callbot-service`
(**không** phải `docs/client-session/05-api-contract.md` — file đó đã lệch thực tế, xem mục 9).

Mỗi mục ghi: hiện trạng → FE đang lách thế nào → cần BE làm gì.

---

## 1. Không có endpoint xoá phiên DRAFT

**Hiện trạng.** `ClientSessionRequestHandler` không khai báo route `/delete`, controller cũng
không có method tương ứng. Nhưng chính message lỗi của `cancel` lại hướng dẫn người dùng
"dùng delete cho DRAFT" — hướng dẫn tới một API không tồn tại.

**FE đang lách.** Ẩn nút xoá. Phiên nháp tạo nhầm sẽ nằm lại danh sách vĩnh viễn.

**Cần BE.** `POST /call-bot/client-session/delete` body `{id}`, chỉ cho phép khi `status = DRAFT`,
xoá luôn staging rows trong ES.

---

## 2. `/client-session/search` bỏ qua toàn bộ filter và không trả total

**Hiện trạng.** Controller chỉ đọc `page` và `size` rồi gọi `sessionRepository.listByTenant(...)`
— một truy vấn match tenant, sort `createdTimeMs` desc. Các field `status[]`, `keyword`,
`createdBy`, khoảng thời gian mà doc hứa đều **không được đọc**. Response là JSON array trần,
không có `total` / `nextPage`.

**FE đang lách.** Tải 50 phiên rồi lọc + sắp xếp + đếm **phía client** (`src/app/sessions/page.tsx`).
Quá 50 phiên là danh sách sai.

**Cần BE.** Đọc filter từ body và trả `{items, total}`. Hiện chỉ `POST /report/summary` filter được
(`statuses`/`fromMs`/`toMs`) nhưng response lại là shape báo cáo, không phải shape phiên.

---

## 3. `/client-session/data/search` không phân trang được

**Hiện trạng.** `ClientDataFilter` **có** `searchAfter`, `createdFromMs`, `createdToMs`, nhưng
controller không đọc 3 field này từ body. Nên cursor pagination không chạm tới được qua HTTP:
mọi lần gọi đều trả trang đầu.

**FE đang lách.** Xin `size: 200` rồi phân trang phía client. Phiên trên 200 dòng là không xem hết được.

**Cần BE.** Đọc `searchAfter` (và khoảng thời gian) từ body, trả `nextSearchAfter` như DTO đã có.

---

## 4. Không có endpoint danh mục đầu số SIP

**Hiện trạng.** Không có route `/active-number` hay `/sip-number` nào trong service. `CallBotActiveNumberDTO`
chỉ xuất hiện như config đầu vào.

**FE đang lách.** Lấy từ PBX gateway (`/public_number_of_tenant/list_active`) rồi map
`provider → gateway`. **Rủi ro thật:** submit sẽ fail nếu đầu số thiếu `gateway`
(`ClientSessionSubmitService` bắt buộc field này), mà lỗi trả về lại không chỉ ra field nào sai.
FE đã tự chặn trước ở `src/lib/validation.ts` và nói rõ "chọn lại từ danh mục".

**Cần BE.** Hoặc mở endpoint proxy danh mục đầu số, hoặc trả mã lỗi riêng cho trường hợp
thiếu `gateway` để FE hướng dẫn chính xác.

---

## 5. `pause` không nhận thời lượng

**Hiện trạng.** `POST /pause` chỉ đọc `{id, cause}`.

**Khác AutoCall.** AutoCall cho chọn tạm dừng 3 phút / 30 phút / 1–24 giờ (`pauseUntilTime`),
hết hạn phiên **tự chạy lại**. CallBot không có → dừng là dừng tới khi bấm tay.

**FE đang lách.** Cho chọn **lý do** tạm dừng thay vì thời lượng, và nói thẳng trên dialog là
"đứng yên cho tới khi bạn bấm Tiếp tục". Không hứa điều backend không làm được.

**Cần BE.** Thêm `pauseUntilTime` (epoch ms) + scheduler tự resume, nếu muốn parity với AutoCall.

---

## 6. `CS_VERSION_CONFLICT` có trong doc nhưng chưa implement

**Hiện trạng.** Mã này không có trong `ClientSessionException`. `update` bump `configVersion`
nhưng **không** kiểm tra version client gửi lên → hai người sửa song song, người sau ghi đè
người trước, im lặng.

**FE đang lách.** Không dựa vào optimistic lock. Autosave 2s có thể ghi đè thay đổi của người khác.

**Cần BE.** Nhận `configVersion` trong body `update`, lệch thì trả `CS_VERSION_CONFLICT`.

---

## 7. `/contact/suggest` chỉ tìm theo số điện thoại

**Hiện trạng.** Controller chặn bằng `keyword.matches("\\d{4,15}")` — gõ tên trả `[]` **im lặng**,
không phân biệt được với "không tìm thấy".

**FE đang lách.** Placeholder ghi rõ là tìm theo số.

**Cần BE.** Ticket B8b (tìm theo tên) như đã ghi trong code.

---

## 8. Không có endpoint stats; realtime phụ thuộc socket gateway ngoài

**Hiện trạng.** Không có `/stats`. Số liệu sống chỉ đến qua Kafka → socket gateway
(`ClientSessionSocketService`, namespace `/call_bot`). **Room là `tenantId`, không phải `sessionId`**
→ client nhận event của mọi phiên trong doanh nghiệp.

**FE đang lách.** First paint lấy `/report/session`, sau đó nghe socket và **tự lọc theo
`clientSessionId`** (`src/lib/realtime.ts`) — không lọc thì phiên khác ghi đè số liệu phiên đang xem.
Nối socket lỗi thì poll 10s.

**Cần BE / team hạ tầng.** Cân nhắc room theo `sessionId`, hoặc xác nhận rõ hợp đồng handshake
(query param, cách join room) — hiện FE suy ra từ `socketConfig` của web-v2, chưa có tài liệu.

---

## 9. `docs/client-session/05-api-contract.md` đã lệch code

Những chỗ doc nói khác thực tế, dễ làm người đọc sau mất thời gian:

| Doc nói | Thực tế trong code |
|---|---|
| Path kiểu `/{id}/data/...` | Path phẳng, `id` nằm trong **body** |
| Envelope `{code, message, data}` | `{status_code: 9999 \| -9999, message, payload}` |
| `POST /import-batch/get` | Route thật là `/import-batch/search` |
| `POST /data/append-mode` | Không tồn tại — `appendMode` là tham số của chính lệnh nạp |
| `POST /delete` | Không tồn tại (mục 1) |
| `POST /{id}/stats` | Không tồn tại (mục 8) |
| `cancel` cần `confirmText` | Controller chỉ đọc `id` và `cause` |

**Đề nghị.** Cập nhật doc theo router, hoặc ghi rõ đầu file rằng router là nguồn đúng.

---

## 10. Chưa có API danh mục nhân viên (người phụ trách)

**Hiện trạng.** Bộ lọc CRM của BE nhận `userOwnerIds` (danh sách id nhân viên), nhưng không có
endpoint nào trả danh sách nhân viên để chọn.

**FE đang lách.** Các ô còn lại đã chuyển sang chọn từ danh mục thật (thẻ / nhóm KH / loại hình
lấy từ `tenant-config`), riêng "Người phụ trách" **vẫn phải gõ id bằng tay** — không ai nhớ id
nhân viên nên ô này gần như không dùng được.

**Cần BE / cần owner cung cấp.** Endpoint danh sách nhân viên trong tenant (id + tên) để làm dropdown,
tương tự cách web-v2 lấy danh sách agent.

---

## 11. Ba bộ lọc CRM mà web-v2 có nhưng BE callbot chưa nhận

**Hiện trạng.** Màn AutoCall lọc khách hàng phong phú hơn `CrmContactFilter` của callbot-service:

| web-v2 có | callbot-service |
|---|---|
| `dynamicFilters: [{field, values}]` — lọc theo **thuộc tính động** của khách hàng | không có |
| `fcFilters` — **bộ lọc KH 2 cấp** (`filter-contact/multilevel/get_all`) | không có |
| `tagIds`, `categoryIds`, `businessIds`, khoảng ngày tạo | **có** |

**FE đang lách.** Chỉ hiển thị các bộ lọc BE nhận được. Không dựng UI cho `dynamicFilters` /
`fcFilters` vì gửi lên sẽ bị bỏ qua âm thầm — người dùng tưởng đã lọc mà thực tế nạp cả danh bạ.

**Cần BE.** Nếu muốn parity với AutoCall thì `CrmContactFilter` cần thêm `dynamicFilters` và
`fcFilters`, và `import-crm` phải chuyển tiếp xuống `autoCall/contact/searchByAttribute`.

---

## Ghi chú thêm: mã lỗi là prefix trong `message`

Lỗi nghiệp vụ trả về dạng `"CS_XXX: mô tả"` trong `message`, **không có field `errorCode` riêng**,
và HTTP luôn 200 (trừ 401 — trả **plain text**, không phải JSON). FE phải parse prefix
(`src/lib/sessionApi.ts`). Nếu BE tách được `errorCode` thành field riêng thì bỏ được đoạn parse này.
