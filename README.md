# Callbot Client Session — Web (Next.js + BFF)

FE mô phỏng và tích hợp luồng **Phiên Callbot từ Client**. Chạy được NGAY với **mock simulator**
(khi backend chưa có controller — ticket B8), flip 1 env var sang **real** khi BE sẵn sàng.

> Nguồn sự thật nghiệp vụ/contract: repo `cloud-vihat-saas-omicrm-callbot-service`
> → `docs/client-session/09-client-integration-guide.md` (góc nhìn FE) + `05-api-contract.md` (REST đầy đủ).
> **Với Claude Code**: mở phiên bằng *"Đọc README.md repo này + docs/client-session/09 & 05 bên repo callbot-service rồi tiếp tục ticket C-xx"*.

## 1. Kiến trúc & quyết định (AD-C)

**Đổi kiến trúc 2026-08-04 (quyết định owner):** real mode trình duyệt **gọi THẲNG** callbot-service
stg, không qua BFF nữa — để Network tab thấy đúng domain thật và bớt một chặng. BFF chỉ còn phục vụ
mock mode.

```
REAL  Browser ──fetch(Bearer token)──▶ https://callbot-v2-stg.omicrm.com/call-bot/...
      (token dán ở UI, lưu localStorage; BE cho phép CORS *)

MOCK  Browser ──fetch──▶ Next.js Route Handlers (/app/api/**) ──▶ MockGateway
                                                                 simulator in-memory:
                                                                 state machine + dispatcher
                                                                 tick + retry + counters
      realtime: SSE /api/.../events (mock only)
```

`src/lib/sessionApi.ts` là **facade duy nhất** UI dùng: mỗi nghiệp vụ tự chọn đường real/mock.
UI không tự dựng URL — đổi endpoint hay đổi mode chỉ sửa 1 file.

| # | Quyết định | Lý do |
|---|---|---|
| AD-C1 | ~~BFF cho mọi call~~ → **real gọi thẳng BE, BFF chỉ cho mock** (2026-08-04) | thấy domain thật khi debug, bớt 1 chặng; đánh đổi: token nằm ở browser và logic map envelope/mã lỗi chạy phía client |
| AD-C2 | Facade `sessionApi` thay cho `CallbotGateway` 2 impl; mock vẫn giữ nguyên guard/error như BE | FE code 1 lần; mock bám sát lỗi thật để flip không bất ngờ |
| AD-C3 | Realtime: mock=SSE từ BFF; real tạm **poll 10s** (số tuyệt đối nên luôn khớp), socket.io thật = ticket C-03c | không nối SSE ở real mode vì SSE đó chỉ có dữ liệu simulator |
| AD-C4 | `src/contracts/*` = mirror TS của docs 05/09; `contracts/mappers.ts` THUẦN (không import server) | dùng được ở cả browser và BFF, không có 2 bản logic tự trôi khỏi nhau |
| AD-C5 | Styling = **Tailwind CSS** (chốt ở C-02a theo template OmiCall) | template có sẵn tokens; không cần component lib nặng |

Nguyên tắc bất di bất dịch (từ docs 09): **counters là SỐ TUYỆT ĐỐI — FE không bao giờ tự cộng dồn từ event**.

## 2. Cấu trúc thư mục

```
src/
├── contracts/          # MIRROR contract BE: types, events, errorCodes (CS_* → message UX)
├── contracts/mappers.ts  # mapper BE→FE THUẦN (không import server) — dùng ở cả browser lẫn BFF
├── bff/                  # CHỈ CHO MOCK MODE
│   ├── gateway.ts        # getGateway() → mockGateway
│   ├── http.ts           # envelope {code,message,data}
│   └── mock/             # store (globalThis, sống qua HMR) + simulator (tick dispatcher,
│                         #   batch theo priority, chen hàng RUN_NOW, retry NO_ANSWER, DRAIN→COMPLETED)
├── app/api/client-session/**   # routes mock: CRUD phiên, actions, data, jobs, report, SSE
├── app/sessions/**              # list + tạo phiên + chi tiết (báo cáo, job nền, bảng data)
└── lib/
    ├── sessionApi.ts     # FACADE: real gọi thẳng BE / mock qua /api/* — UI chỉ dùng file này
    ├── token.ts          # JWT dán tay ở UI (localStorage) + TokenConfig trên header
    ├── apiClient.ts      # fetch /api/* của BFF (bóc envelope, ném ApiError kèm CS_*)
    └── realtime.ts       # useSessionRealtime: SSE ở mock, no-op ở real (C-03c)
```

## 3. Chạy

```bash
npm install
cp .env.example .env   # NEXT_PUBLIC_CALLBOT_MODE=mock — không cần backend
npm run dev            # http://localhost:3000
```

Demo luồng 2 phút: tạo phiên → mở chi tiết → paste vài SĐT (có sẵn 1 số trùng + 1 số sai để thấy DUPLICATE/INVALID)
→ **Submit** → nhìn realtime chạy (mock tick 2s/batch) → thử **Pause/Resume**, nạp thêm data với
"Chạy ngay" (chen hàng) → phiên tự **COMPLETED** khi hết data.

### Real mode — STG (C-03a, đã tích hợp)

`.env` mặc định đã trỏ **REAL** vào `https://callbot-v2-stg.omicrm.com/call-bot` (lưu ý:
`call-bot-stg.omicrm.com` là FRONTEND; origin API trích từ config SPA). Chỉ cần dán JWT:

1. Đăng nhập https://call-bot-stg.omicrm.com → DevTools → Network → copy header `Authorization`
   của request bất kỳ tới `callbot-v2-stg` → bấm nút **Token** trên thanh header của app và dán vào
   (app không có luồng auth; token lưu localStorage, hết hạn thì mở lại dán token mới — nút tự
   cảnh báo ⚠ khi thiếu/hết hạn). `CALLBOT_JWT` trong `.env` chỉ là fallback khi UI chưa có token.
2. `npm run dev` — danh sách/chi tiết/pause/resume/cancel **phiên CŨ** + xem records chạy trên data thật
   (mapping old→new trong `src/bff/real/oldApi.ts`; composite id `sessionId~sessionTimeMs`;
   envelope thật `{status_code: 9999, payload}` đã xử lý; realtime tạm poll 10s).
3. Tạo phiên client / nạp data / submit → UI báo `CS_NOT_READY` cho tới khi backend B8 deploy.
   Muốn demo không cần backend: đổi `NEXT_PUBLIC_CALLBOT_MODE=mock`.

## 4. Roadmap (track C — client)

| # | Việc | Trạng thái |
|---|---|---|
| C-01 | Khung: contracts + BFF 2 mode + mock simulator + trang skeleton demo trọn luồng | ✅ xong |
| C-02 | UI thật theo mẫu (user gửi): wizard tạo phiên, màn data (tab Trùng/Lỗi, paging, import Excel/CRM), màn realtime, báo cáo; chọn styling framework | ⬜ chờ UI mẫu |
| C-03a | Real mode STG với API CŨ: transport (envelope 9999/JWT/composite id) + list/detail/pause/resume/cancel/records + fallback poll | ✅ xong (cần JWT để test data thật) |
| C-03b | Real mode đầy đủ: 23 endpoints mới theo 05 (chờ B8), socket.io tới gateway thật, auth flow | ⬜ chờ BE B8 |
| C-04 | Mock nâng cao khi cần: import Excel giả lập progress, clone phiên, báo cáo/export | ⬜ tuỳ nhu cầu demo |

## 5. Git

Repo này ĐỘC LẬP (như các service khác trong monorepo). **Chưa có remote** — cần tạo project GitLab
(vd `vihat-saas/crm/cloud-vihat-saas-omicrm-callbot-session-web`) rồi:

```bash
git remote add origin https://gitlab.vihatgroup.com/vihat-saas/crm/cloud-vihat-saas-omicrm-callbot-session-web.git
git push -u origin main
```
