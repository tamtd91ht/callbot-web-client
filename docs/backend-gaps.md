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

## 3. `/client-session/data/search` không phân trang được — ✅ ĐÃ XONG 2026-08-19

**Hiện trạng.** `ClientDataFilter` **có** `searchAfter`, `createdFromMs`, `createdToMs`, nhưng
controller không đọc 3 field này từ body. Nên cursor pagination không chạm tới được qua HTTP:
mọi lần gọi đều trả trang đầu.

**FE đang lách.** Xin `size: ROW_FETCH_LIMIT` (=200, hằng số có tên trong `sessionApi.ts`) rồi phân
trang phía client. Phiên trên 200 dòng là không xem hết được.

**Đã sửa 2026-08-19.** Hoá ra chỉ thiếu 3 dòng ở controller: `ClientDataFilter` và ES impl đã hỗ trợ
cursor đầy đủ từ đầu, chỉ `dataSearch` không đọc `searchAfter`/`createdFromMs`/`createdToMs` từ body.
Nay đọc rồi, kèm trần `size` 500. FE dùng `sessionApi.searchRowsPage()` + nút **Tải thêm**.

⚠️ **Cursor-only, không có ô nhập số trang** — cố ý: ES chặn from/size sâu ở `max_result_window`
(10.000) nên page number sẽ hỏng đúng lúc phiên nhiều dữ liệu (xem mục 20).

**Đếm theo tab: đã xong 2026-08-19.** `Counters` thêm field `done` (aggregation vốn đã đếm, chỉ chưa
giữ lại) → tab lấy số TOÀN PHIÊN từ counters realtime thay vì đếm trên tập đã tải. Khi số tab lệch số
dòng đang liệt kê, UI nói rõ ra thay vì để người dùng tự đoán.

**Lọc nguồn + tìm kiếm: đã xong 2026-08-19.** FE đẩy `sources`/`keyword` xuống BE, kèm cờ
`excludeRemoved` mới (không có nó thì dòng đã xoá hiện lại khi lọc chuyển xuống server). Ô tìm kiếm
debounce 400ms — mỗi phím một query ES trên cluster dùng chung là quá tốn.

⚠️ Khi BE đã lọc thì FE **không lọc lại**: BE tìm tên theo prefix, client cũ dùng contains — lọc
chồng sẽ ăn mất dòng hợp lệ.

**Gap này đã đóng hoàn toàn** (phân trang cursor + đếm tab toàn phiên + lọc nguồn + tìm kiếm).

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

## 4b. Không trả lời được "đợt nạp X gọi xong chưa?" — ✅ ĐÃ XONG 2026-08-19

**Trước đây.** Mọi số liệu đều gộp cả phiên. Người dùng nạp bổ sung rồi hỏi "đợt đó chạy tới đâu"
thì không có gì để xem. ADR FR-005 (docs 11) có thiết kế nhưng phương án D chưa code.

**Nay.** `POST /import-batch/search` nhận `withCallProgress: true` → mỗi đợt IMPORT kèm
`callProgress` (total/waiting/calling/done/duplicated/invalid/completed/percent). FE hiện khối
"Tiến độ gọi của đợt này" trong `JobsPanel`.

⚠️ Đừng nhầm `callProgress` với `processedRows/inserted`: những field kia là tiến độ **NẠP**, xong
từ lâu trước khi gọi. Đó là lý do UI để hai khối tách rời.

⚠️ Redis counter của ADR docs 11 phương án D **vẫn cần** khi làm recall theo đợt — dispatcher check
mỗi tick thì aggregation ES là quá đắt. Cái làm ở đây chỉ phục vụ câu hỏi của người dùng.

---

## 5. `pause` không nhận thời lượng — ✅ ĐÃ XONG 2026-08-19

**Hiện trạng.** `POST /pause` nhận thêm `pauseMinutes` (**không bắt buộc**, trần 7 ngày).
Bỏ trống = dừng vô thời hạn.

**Khác AutoCall — CÓ CHỦ Ý, không phải thiếu tính năng.** AutoCall *bắt buộc* chọn thời lượng.
Quyết định owner: ở đây "dừng chủ động thì cũng chủ động chạy lại" là **mặc định**; hẹn giờ chỉ là
tuỳ chọn thêm. Vì vậy trong dialog, "Tới khi tôi bấm Tiếp tục" luôn là lựa chọn **đầu tiên và mặc
định** — đừng đổi thứ tự cho giống AutoCall.

**BE thực thi bằng** tick `AUTO_RESUME` (không thêm scheduler quét định kỳ). Phiên dừng vô thời hạn
thì **tuyệt đối không tự chạy lại** — có test riêng canh bất biến này.

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

## 13. ~~Báo cáo khách hàng: không lấy được tổng hợp toàn phiên~~ — ĐÃ XONG

~~Ghi nhận 2026-08-13 khi dựng tab "Báo cáo khách hàng".~~

**ĐÃ GIẢI QUYẾT cùng ngày** (commit `b94c212`): BE thêm `POST /report/customer/summary`, dùng CHUNG
hàm dựng query với `/report/customer/list` nên số trên ô luôn khớp danh sách bên dưới. Trả
`totalCustomers`, 4 chỉ tiêu thời lượng, `byBestStatus`, `answeredCustomers`, `answerRateByCustomer`.
FE đã nối (`sessionApi.customerReportSummary`).

⚠️ **Chưa deploy lên stg tính đến 2026-08-13**: `list` và `detail` trả 401, riêng `summary` trả
**404 HTML**. Route ĐÃ có trong `ClientSessionRequestHandler:60` nên không phải lỗi sai package —
chỉ là jar cũ. FE tự nhận biết 404 và hiện banner vàng, bảng vẫn chạy bình thường.

## 14. `/report/customer/list` buộc client tự đoán cửa sổ thời gian của phiên

**Hiện trạng.** `fromMs`/`toMs` **bắt buộc** (`CustomerReportSearchService:57-60`, ném
`"Thieu fromMs/toMs"` — chuỗi trần, **không có prefix `CS_`** nên FE không map được sang tiếng Việt).
Range lọc trên `sessionTimeMs`, và index chia theo **NĂM**. Nhưng khi người dùng đang mở đúng một
phiên thì BE đã có `sessionId` — thừa sức tự tra mốc phiên.

**FE đang lách.** Neo cửa sổ vào mốc phiên rồi nới `-1 ngày / +400 ngày` (`WINDOW_BEFORE_MS`,
`WINDOW_AFTER_MS`). Với phiên luồng cũ mốc lấy từ id ghép `sessionId~sessionTimeMs`; luồng mới lấy
`startTimeMs`/`createdTimeMs`. **Rủi ro giống hệt mục 12d**: đoán sai cửa sổ thì trả **0 dòng, không
lỗi, không log** — trông y hệt "phiên chưa gọi ai". Phiên chạy vắt qua giao thừa mà lệch index năm
cũng rơi vào đúng bẫy này.

**Cần BE.** Cho phép gửi `sessionIds` mà **không** cần `fromMs/toMs` (tự tra mốc phiên để chọn index),
hoặc ít nhất trả mã lỗi có prefix `CS_` để FE dịch được.

**FE đã chặn trước** (2026-08-13): phiên không có mốc thời gian thì bảng KHÔNG gọi API mà báo thẳng
"không xác định được khoảng tra báo cáo" — nếu cứ gọi thì cửa sổ rơi về 1970 và BE trả rỗng im lặng.

## 15. ~~`totalRingingTimeMs` khai trong entity nhưng chưa nối vào API~~ — ĐÃ XONG

**ĐÃ GIẢI QUYẾT** (commit `54baa3d`): builder set đủ, `toRow()` trả `avgRingingTimeMs` +
`avgTalkTimeMs` (BE **đã chia sẵn**, FE không tự chia lại), `Attempt` có `ringingTimeMs`/`talkTimeMs`.
FE đã dựng 2 cột ở bảng + 2 ô ở drawer.

**Ba bẫy phải nhớ khi đụng vào số này** (chép từ javadoc BE, đều đã gặp thật):
1. Mẫu số là `countRingingTime` (số cuộc **đo được**), KHÔNG phải `totalCall` — nhiều cuộc thiếu mốc
   trong `call_stacks`. BE đã chia đúng; FE chỉ hiển thị.
2. `null` = không đo được, `0` = **nghe máy tức thì**. Hai thứ khác hẳn nhau → FE hiện `—` vs `0s`.
3. **Đàm thoại LUÔN nhỏ hơn `billSec`** và đó là đúng định nghĩa (`min(answer_at)` là lúc chặng đầu
   tiên nhấc, `billSec` tính từ lúc KHÁCH nhấc). Đo thật: talk 15,17s ↔ bill 20s. Đừng "sửa" cho khớp.

⚠️ **Còn phụ thuộc mapping ES**: commit ghi rõ 4 field mới **chưa có trong mapping index 2026**,
owner phải chạy bước 6 của `docs/ops/customer-report-index.txt`. Chưa chạy thì consumer lỗi 400 khi
ghi doc có field mới; riêng phần ĐỌC không lỗi — `sum` trên field chưa khai trả 0, nên UI sẽ hiện
`0s`/`—` chứ không báo lỗi. Đây là chỗ dễ tưởng nhầm "FE hỏng".

## 16. `/session/report` (luồng cũ) chỉ đếm theo trạng thái, không có thời lượng

Ghi nhận 2026-08-13 khi dựng trang `/sessions/legacy`.

**Hiện trạng.** `CallBotSessionReportData` chỉ có 7 số đếm: `totalSession`, `totalRecord`,
`totalAnswered/NoAnswer/Failed/Canceled/Processing`. **Không có** `totalBillSec`/`avgBillSec` —
trong khi `/client-session/report/session` của luồng mới đã có đủ 4 chỉ tiêu thời lượng (commit
`b94c212`). Cùng gọi là "báo cáo phiên" nhưng hai bên lệch hẳn về nội dung.

**FE đang lách.** Trang luồng cũ chỉ hiện 6 ô đếm, không có ô thời lượng. Muốn xem thời lượng phải
vào từng phiên rồi mở tab Báo cáo khách hàng (index gom có `totalBillSec`).

**Cần BE.** Bổ sung chỉ tiêu thời lượng cho `/session/report`, hoặc ghi rõ trong doc rằng hai báo
cáo phiên của hai luồng không cùng bộ chỉ tiêu.

## 17. `keyword` của filter luồng cũ bị bỏ qua im lặng khi ≤ 3 ký tự

**Hiện trạng.** `CallBotSessionFilter.query()` chỉ thêm wildcard khi `keyword.length() > 3`. Gửi
"abc" thì BE **không lọc gì cả** và trả về mọi phiên — không lỗi, không cảnh báo. Người dùng tưởng
đã lọc và đọc nhầm kết quả.

**FE đang lách.** Không gửi keyword ngắn hơn 4 ký tự, và hiện banner vàng nói rõ "kết quả chưa lọc
theo tên" (`/sessions/legacy`).

**Cần BE.** Hoặc bỏ ngưỡng, hoặc trả cảnh báo trong response để client biết filter không được áp.

## 18. `CALL_ATTRIBUTE`: BE không validate `actionCodes` thuộc danh mục — mã sai im lặng không khớp

**Hiện trạng.** `RetryConfig.firstInvalidReason()` chỉ đòi `actionCodes` KHÔNG RỖNG, không kiểm giá
trị. Gửi `{"trigger":"CALL_ATTRIBUTE","actionCodes":["MAY_BAN"]}` (thay vì `"BUSY"`) thì request
**qua validate bình thường**, phiên chạy, và **không cuộc nào được gọi lại** — không lỗi, không cảnh
báo cho người dùng. Cố ý theo nguyên tắc "`actionCodes` là list MỞ" (`RetryConfig:66-68`), và không
sửa được ở tầng `RetryConfig` vì đó là đường đi chung với luồng cũ đang chạy production.

**FE đang lách.** Chỉ cho chọn 5 nhóm cố định qua checkbox (`CALL_ATTRIBUTE_CODES` trong
`DistributionModal.tsx`), không có ô nhập tự do → người dùng qua UI không tạo được mã sai.

**Cần BE.** Nếu về sau có client khác gọi thẳng API (Omiflow, script tích hợp), nên chặn ở
`ClientSessionConfigValidator` (chỉ luồng web, không đụng luồng cũ) — BE đã có sẵn
`HangupCauseCatalog.supportedCodes()` để đối chiếu. Hiện chỉ WARN trong log ở
`ClientRuntimeSessionFactory`.

## 19. `CALL_ATTRIBUTE`: chưa có cờ tắt riêng cho trigger mới

**Hiện trạng.** Cờ duy nhất là `callbot.client-session.retry.call-result.enabled` — tắt nó là tắt
**TOÀN BỘ** đường gọi lại, kể cả `CALL_STATUS`/`NO_ANSWER` đã chạy production nhiều năm. Muốn tắt
riêng tính năng mới khi có sự cố thì không có cách nào ngoài rollback.

**FE đang lách.** Không lách được — đây là cờ phía BE. Đường tắt thực tế hiện nay là rollback FE
(bỏ radio "Theo kết quả cuộc gọi"), vì không có option thì không ai tạo được cấu hình mới.

**Cần BE.** Thêm `callbot.client-session.retry.call-attribute.enabled` (mặc định `true`), kiểm ngay
đầu `decideByCallAttribute` và trả `NOT_CONFIGURED`. Đáng làm vì nhóm `REJECTED` chạm ~45% traffic.

---

## 20. `/report/customer/list`: có nhãn số trang nhưng KHÔNG nhảy trang được

**Hiện trạng (2026-08-17).** Endpoint đã trả theo khuôn phân trang chuẩn của hệ (`Paginated`:
`items`/`total_items`/`page_number`/`total_pages`/`has_next`…), nhưng bên dưới **vẫn là
`search_after`**. `page` gửi lên chỉ để BE dựng nhãn — gửi `page=5` mà thiếu `cursor` thì vẫn
nhận trang đầu.

**Vì sao không sửa cho "đúng" hẳn.** ES chặn from/size sâu ở 10.000 doc
(`index.max_result_window`), mà báo cáo một phiên có thể 200k khách. Chuyển sang from/size thật
sẽ ném `Result window is too large` từ khoảng trang 200 trở đi — hỏng đúng lúc dữ liệu nhiều,
tức là đúng lúc người ta cần báo cáo nhất.

**FE đang làm gì.** `CustomerReportTable` giữ `cursorStack`, chỉ có nút Trước/Sau tuần tự và
truyền số trang kèm theo để BE dựng nhãn. **Đừng dựng UI nhảy tới trang bất kỳ** (ô nhập số
trang, danh sách 1·2·3·…) trên endpoint này — nó sẽ không chạy.

**Cần BE nếu thật sự muốn nhảy trang.** Phải đổi cách đánh chỉ mục (vd thêm field số thứ tự ổn
định để seek theo range) chứ không phải sửa tầng API. Chưa có nhu cầu thật nên chưa làm.

---

## Ghi chú thêm: mã lỗi là prefix trong `message`

Lỗi nghiệp vụ trả về dạng `"CS_XXX: mô tả"` trong `message`, **không có field `errorCode` riêng**,
và HTTP luôn 200 (trừ 401 — trả **plain text**, không phải JSON). FE phải parse prefix
(`src/lib/sessionApi.ts`). Nếu BE tách được `errorCode` thành field riêng thì bỏ được đoạn parse này.
