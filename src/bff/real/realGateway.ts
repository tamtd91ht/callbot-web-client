/**
 * RealGateway — tích hợp callbot-service STG thật (https://callbot-v2-stg.omicrm.com).
 *
 * PHẠM VI HIỆN TẠI (C-03a): backend CHƯA có controller luồng client-session (ticket B8) nên:
 *  - DÙNG ĐƯỢC (API cũ, đã verify từ source SessionController):
 *      listSessions / getSession   → /call-bot/session/search, /get-by-id (Paginated + CallBotSessionDTO)
 *      pause / resume / cancel     → /call-bot/session/pause, /continue, /cancel ({sessionId, sessionTimeMs})
 *      searchRows                  → /call-bot/record/search (map record → DataRow read-only)
 *  - CHƯA DÙNG ĐƯỢC → CS_NOT_READY (message rõ ràng cho UI):
 *      createSession / updateSession / submit / addManualRows / removeRows / import excel
 *  - Realtime: chưa nối socket gateway (C-03b) — SSE báo lỗi, UI tự fallback poll.
 * Composite id `sessionId~sessionTimeMs` vì old API cần cả hai.
 */
import type {
  AppendMode, ClientSession, ContactSuggestion, CreateSessionRequest,
  DataRow, ManualRowsRequest, UpdateSessionRequest,
} from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';
import { GatewayError, type CallbotGateway, type SessionAction } from '../gateway';
import {
  callOld, mapRecord, mapSession, parseCompositeId,
  type OldPaginated, type OldRecordDTO, type OldSessionDTO,
} from './oldApi';

function notReady(feature: string): never {
  throw new GatewayError('CS_NOT_READY',
    `${feature}: API luồng phiên client (ticket B8) chưa deploy trên stg — dùng CALLBOT_MODE=mock để demo luồng tạo phiên`);
}

const ACTION_PATH: Record<Exclude<SessionAction, 'submit'>, string> = {
  pause: '/session/pause',
  resume: '/session/continue', // old API gọi là "continue"
  cancel: '/session/cancel',
};

export const realGateway: CallbotGateway = {
  async listSessions(): Promise<ClientSession[]> {
    const page = await callOld<OldPaginated<OldSessionDTO>>('/session/search', {
      filter: {}, page: 1, size: 50,
    });
    return (page.items ?? []).map(mapSession);
  },

  async getSession(id: string): Promise<ClientSession> {
    const { sessionId, sessionTimeMs } = parseCompositeId(id);
    const dto = await callOld<OldSessionDTO>('/session/get-by-id', { sessionId, sessionTimeMs });
    if (!dto) throw new GatewayError('CS_NOT_FOUND', `Session not found: ${sessionId}`);
    return mapSession(dto);
  },

  async doAction(id: string, action: SessionAction): Promise<ClientSession> {
    if (action === 'submit') notReady('Submit phiên client');
    const { sessionId, sessionTimeMs } = parseCompositeId(id);
    await callOld<boolean>(ACTION_PATH[action], { sessionId, sessionTimeMs });
    // old API trả true và xử lý async — đọc lại trạng thái (best-effort, có thể trễ vài giây)
    return this.getSession(id);
  },

  async searchRows(id: string): Promise<DataRow[]> {
    const { sessionId } = parseCompositeId(id);
    const page = await callOld<OldPaginated<OldRecordDTO>>('/record/search', {
      filter: { sessionIds: [sessionId] }, page: 1, size: 200,
    });
    return (page.items ?? []).map((r) => mapRecord(r, id));
  },

  // ============ Chưa có backend (B8) ============
  createSession: (_req: CreateSessionRequest) => notReady('Tạo phiên'),
  updateSession: (_id: string, _patch: UpdateSessionRequest) => notReady('Cập nhật cấu hình phiên'),
  addManualRows: (_id: string, _req: ManualRowsRequest) => notReady('Nạp data vào phiên'),
  removeRows: (_id: string, _rowIds: string[]) => notReady('Xoá dòng data'),
  searchContacts: (_q: string) => notReady('Gợi ý contact CRM'),
  setAppendMode: (_id: string, _mode: AppendMode) => notReady('Đổi chế độ xếp hàng'),

  subscribe(_id: string, _listener: (e: SessionEvent) => void): () => void {
    throw new GatewayError('CS_NOT_READY',
      'Realtime real-mode nối socket gateway ở C-03b — UI tự fallback poll 10s');
  },
};
