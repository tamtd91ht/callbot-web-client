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

## 12. Gọi lại — chỉ thực thi được `NO_ANSWER`; `CONTACT_*` mới là khung

**Cập nhật 2026-08-10.** Mô hình `RetryTrigger` cũ (`NO_ANSWER` / `BOT_ACTION`, merge `87363fa`) đã
được **revert** và thay bằng `CALL_STATUS` / `CONTACT_ATTRIBUTE` / `CONTACT_STATUS`; điều kiện cụ thể
tụt xuống `actionCodes` (list string mở). Mục này viết lại theo hiện trạng mới.

**Chỉ `CALL_STATUS` + mã `NO_ANSWER` là thật sự gọi lại.** Đây là giới hạn CẤU TRÚC của engine cũ,
không phải thiếu cấu hình: `CallBotHandler.appendRecordsRetryCall` chỉ được gọi từ đúng một chỗ —
`handlerNoAnswerCallback` (:1149); `handlerAnsweredCallback` (:1077) không gọi retry. Nên mọi mã ứng
với cuộc CÓ nghe máy (`ANSWER`, `VOICE_MAIL`, `BUSY`) hiện nhận vào nhưng **không gọi lại lần nào**.

**CẬP NHẬT 2026-08-10: `CONTACT_STATUS` đã chạy được.** BE so `actionCodes` với `filterContacts` của
khách (tra contact ES theo `contactId`, thiếu thì fallback `phoneNumber`). Mã lấy từ tenant-config
`POST /filter-contact/list`: `values[].index` → `"1"`, `values[].second_level[].index` → `"1-1"`.
FE đã mở lựa chọn này kèm danh mục thật. `CONTACT_ATTRIBUTE` vẫn khoá — BE đi chung đường nhưng
**chưa có danh mục thuộc tính riêng** để người dùng chọn.

⚠️ **Mock KHÔNG mô phỏng `CONTACT_STATUS`** (store mock không có trạng thái khách) — chọn trigger đó
ở mock sẽ không thấy gọi lại. Muốn kiểm chứng phải chạy real mode.

**(Cũ — giữ làm lịch sử) `CONTACT_ATTRIBUTE` / `CONTACT_STATUS` chưa nối.** BE mới có interface `ContactAttributeProvider` +
bản `Unavailable` luôn trả rỗng kèm log WARN. Lý do: giá trị thuộc tính từng KH nằm ở
**contact-service** (`contact-v1`), repo không có trong workspace nên chưa đọc được contract. Danh mục
thì đã biết chỗ lấy: `POST {tenantConfig}/contact-categories/search-all` (và `/business`, `/tag`).
Cảnh báo kèm: tenant-config-api **chỉ có route internal GHI**, không có route internal ĐỌC.

**Cờ an toàn.** Đường gọi lại mới nằm sau `callbot.client-session.retry.call-result.enabled`,
**mặc định `false`**. Tắt = giữ nguyên hành vi đang chạy trên prod.

**FE đang làm gì.** Modal Phân bổ cho chọn trigger: `CALL_STATUS` và `CONTACT_STATUS` bật, chỉ
`CONTACT_ATTRIBUTE` còn `disabled` kèm chữ "chưa hỗ trợ". Với `CALL_STATUS` thì chọn `actionCodes`
(chỉ `NO_ANSWER` bật, còn lại `disabled`); với `CONTACT_STATUS` thì chọn từ danh mục thật của tenant.
Mock simulator vẫn chỉ gọi lại với `CALL_STATUS` + `NO_ANSWER` — cố ý giữ mock "tệ" đúng bằng BE.

Câu cảnh báo "backend chỉ thực thi khi không nghe máy" nay **chỉ hiện với `CALL_STATUS`**. Trước đó
nó hiện với mọi trigger và còn nói cả trạng thái khách hàng "sẽ mở dần" — người dùng vừa chọn xong
trạng thái khách thì đọc ngay bên dưới thấy bảo chưa hỗ trợ. Giới hạn nào thì nói đúng lúc đó.

**Đã sửa ở đợt này (không còn là nợ):** cuộc gọi lại của luồng B giờ CÓ mang
`ringTimeout`/`maxCallTime` (factory set 2 field lên `CallBotSession`); counters
`answered/noAnswer/failed/canceled/retried` đã được ghi thật thay vì luôn bằng 0.

### 12b. `sanitizeConfig` nuốt `retryConfig: null` → không tắt được gọi lại qua update

`mappers.ts:392` loại mọi key `null`/`undefined` trước khi gửi, nên `update({retryConfig: null})`
không bao giờ tới BE — người dùng bỏ tick "Gọi lại tự động" ở phiên đã tạo thì cấu hình cũ **vẫn còn**.
Cách tắt hiện tại là gửi `maxRetry: 0` (BE hiểu đúng là tắt có chủ đích). Sửa triệt để cần BE cho phép
`null` tường minh hoặc FE có đường riêng để xoá field.

### 12c. Wrapper KHÔNG đọc `ringTimeout` / `maxCallTime` (đã đọc code, xác nhận)

`wrapper-auto-call-service` **hard-code** `originate_timeout=60` và `call_timeout=20` trong tham số
originate (`AutoCallService.java:457,547,760,850,1114,1133,1352,1365,1582,1595`) và **không có field
nào** trong `BaseRequest`/`CallBotRequest` nhận 2 giá trị này. Nghĩa là cấu hình "Chờ kết nối" và
"Thời lượng cuộc tối đa" người dùng nhập ở UI **hiện không tới được FreeSWITCH** dù BE gửi đủ.
Cần làm việc với team wrapper. Xác nhận thêm: wrapper **không tự retry** (1 message = 1 lần originate)
và **không biết hangup cause** (do `lua hangup_hook.lua` trên FreeSWITCH, ngoài repo).

### 12d. `/record/search` bắt buộc `fromDate`/`toDate`, và range chạy trên `sessionTimeMs`

Lịch sử cuộc gọi phải mượn endpoint luồng cũ `POST /call-bot/record/search` (luồng client chưa có
endpoint riêng). Ba ràng buộc của nó bắt FE phải chế thêm dữ liệu người dùng không hề nhập:

1. **`fromDate`/`toDate` là BẮT BUỘC** — thiếu một trong hai là ném `"invalid time range"`
   (`CallBotFilter.java:43-45`), không có mặc định "toàn bộ thời gian". Đây chính là lỗi UI báo khi
   search record: màn hình không có ô chọn ngày nên FE trước đó không gửi gì cả.
2. **So sánh là `fromDate >= toDate`** → hai mốc BẰNG NHAU cũng lỗi, nên không thể gửi đúng một
   điểm thời gian; buộc phải nới cửa sổ ra hai bên.
3. **`toDate` tương lai bị kẹp về `now` TRƯỚC khi so sánh** (`CallBotFilter.java:40-42`) → phiên hẹn
   giờ tương lai mà gửi cả cặp mốc tương lai sẽ bị lật thành `from >= to` và dính lại đúng lỗi trên.

Bẫy lớn nhất: cặp mốc này **không phải "khoảng thời gian các cuộc gọi"**. ES lọc range trên
`sessionTimeMs` — thời điểm của PHIÊN, mọi record trong phiên mang cùng một giá trị
(`CallBotFilter.java:51`). Nên cửa sổ phải neo vào mốc phiên; nếu dùng kiểu "N ngày gần đây" thì
phiên cũ trả **0 dòng, không lỗi, không log** — trông y hệt "phiên chưa gọi ai".
Nới rộng cũng vô ích: chỉ làm ES fan-out qua nhiều index tháng (`esIndices()`, `FrequencyEnum.MONTHLY`).

Mã lỗi trả về là chuỗi trần `"invalid time range"`, **không có prefix `CS_`**, nên FE không map được
sang thông báo tiếng Việt — người dùng thấy nguyên văn tiếng Anh (rơi vào `CS_UPSTREAM_ERROR`).

**Đề xuất BE**: luồng client cần endpoint search record riêng, lấy khoảng thời gian từ chính phiên
(đã có `sessionId`) thay vì bắt client tự suy ra. Hiện FE workaround bằng `recordSearchWindow()`
trong `src/lib/sessionApi.ts`.

### 12e. Tên field trạng thái record là `status`, không phải `statuses`

`CallBotRecordFilter.java:34` khai `status`. FE trước đó gửi `statuses` → do
`@JsonIgnoreProperties(ignoreUnknown = true)` nên BE **nuốt im lặng**, không báo lỗi: bấm tab trạng
thái nào cũng ra cùng một danh sách. Không có cách nào phát hiện từ response — chỉ đọc DTO mới thấy.

---

## Ghi chú thêm: mã lỗi là prefix trong `message`

Lỗi nghiệp vụ trả về dạng `"CS_XXX: mô tả"` trong `message`, **không có field `errorCode` riêng**,
và HTTP luôn 200 (trừ 401 — trả **plain text**, không phải JSON). FE phải parse prefix
(`src/lib/sessionApi.ts`). Nếu BE tách được `errorCode` thành field riêng thì bỏ được đoạn parse này.
