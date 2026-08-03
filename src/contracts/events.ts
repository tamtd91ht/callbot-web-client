/**
 * Socket/SSE events — mirror docs 09 §3 (payload đã chốt với BE).
 * Mock mode: BFF đẩy qua SSE. Real mode: socket.io namespace /call_bot room=tenantId (C-03).
 */
import type { ClientSessionStatus, SessionCounters } from './types';

export interface ClientSessionStatsEvent {
  event: 'clientSessionStats';
  data: {
    clientSessionId: string;
    sessionName: string;
    status: ClientSessionStatus;
    runtimeSessionId?: string | null;
    totalCalling: number;
    currentCCU?: number | null; // có thể vắng (cache hết hạn / A8b chưa wire) — render "—"
    maxCCU?: number | null;
    counters: SessionCounters;
  };
}

export interface ClientSessionLifecycleEvent {
  event: 'clientSessionLifecycle';
  data: {
    clientSessionId: string;
    sessionName: string;
    status: ClientSessionStatus;
    cause?: string | null;
    atMs: number;
  };
}

export type SessionEvent = ClientSessionStatsEvent | ClientSessionLifecycleEvent;
