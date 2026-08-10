/**
 * Simulator dispatcher — mô phỏng vòng tick của SessionDispatcher backend (docs 03 §3.2)
 * đủ để FE tích hợp thật: batch theo priority, chen hàng RUN_NOW, retry NO_ANSWER,
 * counters SỐ TUYỆT ĐỐI, DRAIN → COMPLETED, pause/resume/cancel đúng state machine.
 * Tỉ lệ kết quả: 65% nghe máy, 30% không nghe (retry nếu cấu hình), 5% lỗi.
 */
import type { SessionCounters } from '@/contracts/types';
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
        // VOICE_MAIL…) và trigger CONTACT_* được nhận nhưng CHƯA thực thi, không gọi lại lần nào.
        // Đừng "sửa" mock cho tử tế hơn BE — mock tốt hơn thật là cách chắc nhất để lộ bug ở prod.
        if (retry && retry.trigger === 'CALL_STATUS'
          && (retry.actionCodes ?? []).some((c) => c.trim().toUpperCase() === 'NO_ANSWER')
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
  const dispatched = by((r) => r.rowStatus === 'DISPATCHED' || r.rowStatus === 'DONE');
  return {
    total: state.rows.length,
    staged,
    duplicated: by((r) => r.rowStatus === 'DUPLICATE'),
    invalid: by((r) => r.rowStatus === 'INVALID'),
    queued,
    dispatched,
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
