/**
 * In-memory store cho mock mode. Dùng globalThis để sống sót qua HMR của `next dev`
 * (mỗi lần hot-reload module bị nạp lại nhưng globalThis giữ nguyên).
 */
import type { ClientSession, DataRow, ImportBatch } from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';

export interface MockSessionState {
  session: ClientSession;
  rows: DataRow[];
  /** Lịch sử job nền (mock chạy đồng bộ nên batch tạo ra đã ở trạng thái DONE). */
  importBatches?: ImportBatch[];
  /** timer id của tick dispatcher mô phỏng — null khi không chạy */
  timer: ReturnType<typeof setInterval> | null;
  listeners: Set<(e: SessionEvent) => void>;
  seq: number;
}

interface MockDb {
  sessions: Map<string, MockSessionState>;
  idCounter: number;
}

const g = globalThis as unknown as { __callbotMockDb?: MockDb };

export function db(): MockDb {
  if (!g.__callbotMockDb) {
    g.__callbotMockDb = { sessions: new Map(), idCounter: 1 };
  }
  return g.__callbotMockDb;
}

export function nextId(prefix: string): string {
  return `${prefix}_${(db().idCounter++).toString(36)}${Date.now().toString(36)}`;
}

export function emit(state: MockSessionState, event: SessionEvent): void {
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch {
      /* listener chết không được giết simulator */
    }
  }
}
