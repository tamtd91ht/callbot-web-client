/**
 * RealGateway — proxy sang callbot-service thật (CALLBOT_MODE=real).
 * Map 1-1 endpoints theo docs 05; JWT giữ Ở BFF (browser không bao giờ thấy).
 * TRẠNG THÁI: skeleton — bật được khi BE ticket B8 (controller) xong. Ticket phía FE: C-03.
 * Realtime real-mode: FE nối socket gateway trực tiếp (namespace /call_bot, room tenantId),
 * KHÔNG qua BFF — subscribe() ở đây chỉ dùng cho mock.
 */
import type {
  AppendMode, ApiEnvelope, ClientSession, CreateSessionRequest, DataRow, ManualRowsRequest,
} from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';
import { GatewayError, type CallbotGateway, type SessionAction } from '../gateway';

const BASE = () => process.env.CALLBOT_BASE_URL || 'http://localhost:8080/call-bot';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CALLBOT_JWT || ''}`,
    },
    body: body ? JSON.stringify(body) : '{}',
    cache: 'no-store',
  });
  const envelope = (await res.json()) as ApiEnvelope<T>;
  if (envelope.code !== 200) {
    throw new GatewayError(envelope.errorCode || 'CS_UNKNOWN', envelope.message);
  }
  return envelope.data;
}

export const realGateway: CallbotGateway = {
  createSession: (req: CreateSessionRequest) => call<ClientSession>('/client-session/create', req),
  listSessions: () => call<ClientSession[]>('/client-session/search', {}),
  getSession: (id: string) => call<ClientSession>('/client-session/get-by-id', { id }),
  doAction: (id: string, action: SessionAction) => call<ClientSession>(`/client-session/${action}`, { id }),
  addManualRows: (id: string, req: ManualRowsRequest) =>
    call(`/client-session/${id}/data/manual`, req),
  searchRows: (id: string, statuses?: string[]) =>
    call<DataRow[]>(`/client-session/${id}/data/search`, { rowStatuses: statuses }),
  setAppendMode: (id: string, mode: AppendMode) =>
    call<void>(`/client-session/${id}/data/append-mode`, { mode }),
  subscribe(): () => void {
    throw new GatewayError(
      'CS_UNSUPPORTED',
      'Real mode: FE nối socket gateway trực tiếp (ticket C-03) — SSE của BFF chỉ dành cho mock',
    );
  },
};
