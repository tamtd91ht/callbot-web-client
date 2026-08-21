/**
 * Simulator dispatcher — mô phỏng vòng tick của SessionDispatcher backend (docs 03 §3.2)
 * đủ để FE tích hợp thật: batch theo priority, chen hàng RUN_NOW, retry NO_ANSWER,
 * counters SỐ TUYỆT ĐỐI, DRAIN → COMPLETED, pause/resume/cancel đúng state machine.
 * Tỉ lệ kết quả: 65% nghe máy, 30% không nghe (retry nếu cấu hình), 5% lỗi.
 */
import type { SessionCounters } from '@/contracts/types';
import { effectiveRetryConditions } from '@/lib/retryLabels';
import { emit, type MockSessionState } from './store';

const TICK_MS = Number(process.env.MOCK_TICK_MS || 2000);

export function startTicking(state: MockSessionState): void {
  if (state.timer) return;
  state.timer = setInterval(() => tick(state), TICK_MS);
}

export function stopTicking(state: MockSessionState): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function tick(state: MockSessionState): void {
  const { session } = state;
  if (session.status === 'SCHEDULED') {
    if (session.startTimeMs && session.startTimeMs > Date.now()) {
      return; // chưa tới giờ
    }
    session.status = 'RUNNING';
    emitLifecycle(state, null);
  }
  if (session.status !== 'RUNNING') return;

  // 1. Resolve các dòng đang gọi (DISPATCHED chưa có kết quả) — mô phỏng callback FS
  for (const row of state.rows) {
    if (row.rowStatus === 'DISPATCHED' && !row.callResult) {
      const r = Math.random();
      if (r < 0.65) {
        row.callResult = 'ANSWERED';
        row.rowStatus = 'DONE';
      } else if (r < 0.95) {
        row.callResult = 'NO_ANSWER';
        const retry = session.retryConfig;
        const retried = Number(row.variables?.__retryCount || 0);
        // CHỈ mã NO_ANSWER của trigger CALL_STATUS — đúng hiện trạng BE: mã khác (ANSWER,
        // VOICE_MAIL…) nhận nhưng CHƯA thực thi vì engine cũ chỉ gọi lại ở nhánh không-nghe-máy.
        // Đừng "sửa" mock cho tử tế hơn BE — mock tốt hơn thật là cách chắc nhất để lộ bug ở prod.
        //
        // CONTACT_STATUS: BE đã chạy được (so actionCodes với filterContacts của khách qua contact ES),
        // nhưng mock KHÔNG mô phỏng — store mock không có trạng thái khách. Chọn trigger đó ở mock thì
        // không thấy gọi lại; muốn kiểm chứng phải chạy real mode.
        // [CALL_ATTRIBUTE] Cuộc không kết nối được mang thêm NHÓM kết quả chi tiết. Phân bố bám tỉ
        // lệ đo trên CDR production tháng 8/2026 để mock không cho cảm giác sai về mức độ ảnh hưởng:
        // REJECTED (nhà mạng chặn) chiếm gần nửa, không phải một ca hiếm.
        const attributeCode = pickAttributeCode();
        // [2026-08-21] Nhiều điều kiện, ngữ nghĩa HOẶC — đúng RetryDecider: một điều kiện khớp là
        // gọi lại. effectiveRetryConditions phủ cả dạng cũ (session mock tạo trước ngày đổi).
        const matchesTrigger = !!retry && effectiveRetryConditions(retry).some((condition) => (
          (condition.trigger === 'CALL_STATUS'
            && (condition.actionCodes ?? []).some((c) => c.trim().toUpperCase() === 'NO_ANSWER'))
          || (condition.trigger === 'CALL_ATTRIBUTE'
            && (condition.actionCodes ?? []).some((c) => c.trim().toUpperCase() === attributeCode))
        ));
        if (retry && matchesTrigger
          && retried < retry.maxRetry) {
          // clone-retry: quay lại hàng đợi, giữ priority (mô phỏng appendRecordsRetryCall)
          row.variables = { ...row.variables, __retryCount: String(retried + 1) };
          row.rowStatus = 'STAGED';
          row.callResult = null;
        } else {
          row.rowStatus = 'DONE';
        }
      } else {
        row.callResult = 'FAILED';
        row.rowStatus = 'DONE';
      }
    }
  }

  // 2. Kéo batch STAGED theo (priority asc, createdTimeMs asc) — đúng sort dispatcher
  const staged = state.rows
    .filter((r) => r.rowStatus === 'STAGED')
    .sort((a, b) => a.priority - b.priority || a.createdTimeMs - b.createdTimeMs)
    .slice(0, session.batchSize);
  for (const row of staged) {
    row.rowStatus = 'DISPATCHED';
    row.recordId = row.recordId || `rec_${row.rowId}`;
  }

  emitStats(state);

  // 3. DRAIN → COMPLETED: hết STAGED + không còn cuộc đang chạy
  const inFlight = state.rows.some((r) => r.rowStatus === 'DISPATCHED' && !r.callResult);
  const hasStaged = state.rows.some((r) => r.rowStatus === 'STAGED' || r.rowStatus === 'QUEUED');
  if (!hasStaged && !inFlight) {
    session.status = 'COMPLETED';
    session.completedTimeMs = Date.now();
    session.counters = computeCounters(state);
    stopTicking(state);
    emitLifecycle(state, null);
  }
}

export function computeCounters(state: MockSessionState): SessionCounters {
  const by = (f: (r: (typeof state.rows)[number]) => boolean) => state.rows.filter(f).length;
  const staged = by((r) => r.rowStatus === 'STAGED');
  const queued = by((r) => r.rowStatus === 'QUEUED');
  // Gộp DISPATCHED+DONE cho ô "Đang/đã gọi" ở khối số liệu; nhưng tab data cần TÁCH hai trạng
  // thái nên phải trả riêng `done` — khớp BE (aggregateByStatus đếm theo từng rowStatus).
  const dispatched = by((r) => r.rowStatus === 'DISPATCHED' || r.rowStatus === 'DONE');
  return {
    total: state.rows.length,
    staged,
    duplicated: by((r) => r.rowStatus === 'DUPLICATE'),
    invalid: by((r) => r.rowStatus === 'INVALID'),
    queued,
    dispatched,
    done: by((r) => r.rowStatus === 'DONE'),
    remaining: staged + queued,
    answered: by((r) => r.callResult === 'ANSWERED'),
    noAnswer: by((r) => r.callResult === 'NO_ANSWER'),
    failed: by((r) => r.callResult === 'FAILED'),
    canceled: by((r) => r.callResult === 'CANCELED'),
    totalRecords: dispatched,
    retried: state.rows.filter((r) => Number(r.variables?.__retryCount || 0) > 0).length,
  };
}

export function emitStats(state: MockSessionState): void {
  const counters = computeCounters(state);
  state.session.counters = counters;
  emit(state, {
    event: 'clientSessionStats',
    data: {
      clientSessionId: state.session.id,
      sessionName: state.session.name,
      status: state.session.status,
      runtimeSessionId: state.session.runtimeSessionId,
      totalCalling: state.rows.filter((r) => r.rowStatus === 'DISPATCHED' && !r.callResult).length,
      currentCCU: Math.min(counters.remaining + 5, 37), // giả lập — real mode lấy từ wrapper callback
      maxCCU: 100,
      counters,
    },
  });
}

/**
 * Bốc ngẫu nhiên một NHÓM kết quả cho cuộc không kết nối được, theo phân bố THẬT.
 *
 * Tỉ lệ lấy từ CDR production tháng 8/2026 (1,95 triệu cuộc callbot), chuẩn hoá trên tập cuộc chưa
 * kết nối: nhà mạng chặn ~55%, ngoài vùng phủ ~23%, bận ~9%, không nghe máy ~7%, lỗi ~2,5%, số không
 * tồn tại ~1,1%, thuê bao chặn ~0,8%, voicemail ~1,5%.
 *
 * Cố ý KHÔNG chia đều 8 nhóm — chia đều sẽ khiến người thử mock tưởng "nhà mạng chặn" cũng chỉ như
 * mọi nhóm khác, trong khi thật ra nó áp đảo và là nhóm dễ gây gọi lại tràn lan nhất.
 *
 * ⚠️ Mock đơn giản hoá một điểm so với BE thật: ở đây voicemail là một nhánh của cuộc KHÔNG nghe
 * máy, còn thực tế 68% cuộc voicemail có bill_sec > 0 (hộp thư tự nhấc máy) và BE phải cắt voicemail
 * TRƯỚC cả `answered` mới phân loại đúng. Muốn kiểm chứng luật đó phải chạy real mode.
 */
function pickAttributeCode(): string {
  const r = Math.random();
  if (r < 0.55) return 'REJECTED';
  if (r < 0.78) return 'SUBSCRIBER_UNAVAILABLE';
  if (r < 0.87) return 'BUSY';
  if (r < 0.94) return 'NO_ANSWER';
  if (r < 0.965) return 'UNKNOWN_ERROR';
  if (r < 0.977) return 'NUMBER_NOT_EXIST';
  if (r < 0.985) return 'CALL_BARRED';
  return 'VOICE_MAIL';
}

export function emitLifecycle(state: MockSessionState, cause: string | null): void {
  emit(state, {
    event: 'clientSessionLifecycle',
    data: {
      clientSessionId: state.session.id,
      sessionName: state.session.name,
      status: state.session.status,
      cause,
      atMs: Date.now(),
    },
  });
}
