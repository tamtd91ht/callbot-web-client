# Callbot Client Session — Web (Next.js + BFF)

FE mô phỏng và tích hợp luồng **Phiên Callbot từ Client**. Chạy được NGAY với **mock simulator**
(khi backend chưa có controller — ticket B8), flip 1 env var sang **real** khi BE sẵn sàng.

> Nguồn sự thật nghiệp vụ/contract: repo `cloud-vihat-saas-omicrm-callbot-service`
> → `docs/client-session/09-client-integration-guide.md` (góc nhìn FE) + `05-api-contract.md` (REST đầy đủ).
> **Với Claude Code**: mở phiên bằng *"Đọc README.md repo này + docs/client-session/09 & 05 bên repo callbot-service rồi tiếp tục ticket C-xx"*.

## 1. Kiến trúc & quyết định (AD-C)

```
Browser ──fetch──▶ Next.js Route Handlers (/app/api/**)  ◀── BFF, JWT chỉ ở đây
                        │
                        ▼  CallbotGateway (interface duy nhất)
        ┌───────────────┴────────────────┐
   MockGateway (mặc định)           RealGateway (CALLBOT_MODE=real)
   simulator in-memory:             proxy REST → callbot-service
   state machine + dispatcher       theo docs 05 (chờ BE B8)
   tick + retry + counters
        │
        ▼ realtime
   SSE /api/.../events              FE nối socket gateway TRỰC TIẾP
   (mock only)                      (/call_bot, room=tenantId) — ticket C-03
```

| # | Quyết định | Lý do |
|---|---|---|
| AD-C1 | BFF = **Next.js Route Handlers** (không service riêng) | 1 deployable; JWT/secret không bao giờ xuống browser; đủ cho aggregate + mode switch |
| AD-C2 | `CallbotGateway` interface + 2 impl **mock/real**, switch bằng `CALLBOT_MODE` | FE code 1 lần; mock bám sát guard/error thật để flip không bất ngờ |
| AD-C3 | Realtime trừu tượng qua hook `useSessionRealtime`: mock=SSE từ BFF, real=socket.io trực tiếp | màn hình không đổi code khi flip; socket thật không cần proxy (gateway đã có) |
| AD-C4 | `src/contracts/*` = mirror TS của docs 05/09 — nguồn sự thật FE | contract đổi → sửa 1 chỗ, TS bắt hết chỗ vỡ |
| AD-C5 | **Chưa chọn UI framework/styling** — skeleton CSS thuần | chờ UI mẫu (ticket C-02) rồi quyết Tailwind/AntD/... một lần |

Nguyên tắc bất di bất dịch (từ docs 09): **counters là SỐ TUYỆT ĐỐI — FE không bao giờ tự cộng dồn từ event**.

## 2. Cấu trúc thư mục

```
src/
├── contracts/          # MIRROR contract BE: types, events, errorCodes (CS_* → message UX)
├── bff/
│   ├── gateway.ts      # interface CallbotGateway + getGateway() theo CALLBOT_MODE
│   ├── http.ts         # envelope {code,message,data} — giữ đúng format BE
│   ├── mock/           # store (globalThis, sống qua HMR) + simulator (tick dispatcher,
│   │                   #   batch theo priority, chen hàng RUN_NOW, retry NO_ANSWER, DRAIN→COMPLETED)
│   └── real/           # proxy REST → callbot-service (skeleton, bật khi B8 xong)
├── app/api/client-session/**   # BFF routes: CRUD phiên, actions, data, SSE events
├── app/sessions/**              # trang skeleton: list + detail realtime (UI thật ở C-02)
└── lib/                # apiClient (bóc envelope, ném ApiError kèm CS_*) + useSessionRealtime
```

## 3. Chạy

```bash
npm install
cp .env.example .env   # mặc định CALLBOT_MODE=mock — không cần backend
npm run dev            # http://localhost:3000
```

Demo luồng 2 phút: tạo phiên → mở chi tiết → paste vài SĐT (có sẵn 1 số trùng + 1 số sai để thấy DUPLICATE/INVALID)
→ **Submit** → nhìn realtime chạy (mock tick 2s/batch) → thử **Pause/Resume**, nạp thêm data với
"Chạy ngay" (chen hàng) → phiên tự **COMPLETED** khi hết data.

Flip sang backend thật (sau B8): `.env` → `CALLBOT_MODE=real` + `CALLBOT_BASE_URL` + `CALLBOT_JWT`.

## 4. Roadmap (track C — client)

| # | Việc | Trạng thái |
|---|---|---|
| C-01 | Khung: contracts + BFF 2 mode + mock simulator + trang skeleton demo trọn luồng | ✅ xong |
| C-02 | UI thật theo mẫu (user gửi): wizard tạo phiên, màn data (tab Trùng/Lỗi, paging, import Excel/CRM), màn realtime, báo cáo; chọn styling framework | ⬜ chờ UI mẫu |
| C-03 | Real mode hoàn chỉnh: wire 23 endpoints theo 05, socket.io tới gateway thật, auth flow JWT | ⬜ chờ BE B8 |
| C-04 | Mock nâng cao khi cần: import Excel giả lập progress, clone phiên, báo cáo/export | ⬜ tuỳ nhu cầu demo |

## 5. Git

Repo này ĐỘC LẬP (như các service khác trong monorepo). **Chưa có remote** — cần tạo project GitLab
(vd `vihat-saas/crm/cloud-vihat-saas-omicrm-callbot-session-web`) rồi:

```bash
git remote add origin https://gitlab.vihatgroup.com/vihat-saas/crm/cloud-vihat-saas-omicrm-callbot-session-web.git
git push -u origin main
```
