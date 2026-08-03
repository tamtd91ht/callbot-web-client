/**
 * RealGateway — tích hợp callbot-service STG thật (https://callbot-v2-stg.omicrm.com).
 *
 * C-03b: backend B8 đã có 12 endpoints /call-bot/client-session/* (branch
 * feature/client-session-foundation) — toàn bộ CRUD/lifecycle/data dùng API MỚI.
 * Phân biệt 2 loại id:
 *  - id hex Mongo (không có '~')      → phiên CLIENT mới → /client-session/*
 *  - composite `sessionId~timeMs`     → phiên LUỒNG CŨ (WEB/API/CAMPAIGN) → API cũ, read-only
 * Realtime: chưa nối socket gateway (C-03c) — subscribe báo CS_NOT_READY, UI tự fallback poll 10s.
 */
import type {
  AppendMode, ClientSession, ContactSuggestion, CreateSessionRequest, CrmContactFilter,
  DataRow, ImportBatch, ImportExcelResult, ManualRowsRequest, SessionReport, UpdateSessionRequest,
} from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';
import { GatewayError, type CallbotGateway, type SessionAction } from '../gateway';
import {
  callOld, mapRecord, mapSession, parseCompositeId,
  type OldPaginated, type OldRecordDTO, type OldSessionDTO,
} from './oldApi';
import {
  csCall, csUpload, mapClientRow, mapClientSession, mapContactSuggestion, mapImportBatch, sanitizeConfig,
  type BeClientSession, type BeDataPage, type BeDataRow, type BeImportBatch, type BeIngestResult,
} from './clientSessionApi';

const isLegacyId = (id: string) => id.includes('~');

/** Phiên luồng cũ chỉ xem — mọi thao tác của luồng client mới đều không áp dụng được. */
function requireClientSession(id: string, feature: string): void {
  if (isLegacyId(id)) {
    throw new GatewayError('CS_INVALID_STATE', `${feature}: phiên luồng cũ chỉ xem, không thao tác được từ app này`);
  }
}

const LEGACY_ACTION_PATH: Record<Exclude<SessionAction, 'submit'>, string> = {
  pause: '/session/pause',
  resume: '/session/continue', // old API gọi là "continue"
  cancel: '/session/cancel',
};

export const realGateway: CallbotGateway = {
  async createSession(req: CreateSessionRequest): Promise<ClientSession> {
    const dto = await csCall<BeClientSession>('/create', sanitizeConfig(req));
    return mapClientSession(dto);
  },

  async listSessions(): Promise<ClientSession[]> {
    // Phiên client mới là chính; phiên luồng cũ append best-effort (JWT có quyền cũ mới thấy)
    const [fresh, legacy] = await Promise.allSettled([
      csCall<BeClientSession[]>('/search', { page: 1, size: 50 }),
      callOld<OldPaginated<OldSessionDTO>>('/session/search', { filter: {}, page: 1, size: 50 }),
    ]);
    if (fresh.status === 'rejected') throw fresh.reason;
    const result = (fresh.value ?? []).map(mapClientSession);
    if (legacy.status === 'fulfilled') {
      result.push(...(legacy.value.items ?? []).map(mapSession));
    }
    return result;
  },

  async getSession(id: string): Promise<ClientSession> {
    if (isLegacyId(id)) {
      const { sessionId, sessionTimeMs } = parseCompositeId(id);
      const dto = await callOld<OldSessionDTO>('/session/get-by-id', { sessionId, sessionTimeMs });
      if (!dto) throw new GatewayError('CS_NOT_FOUND', `Session not found: ${sessionId}`);
      return mapSession(dto);
    }
    const dto = await csCall<BeClientSession>('/get-by-id', { id });
    if (!dto) throw new GatewayError('CS_NOT_FOUND', `Client session not found: ${id}`);
    return mapClientSession(dto);
  },

  async updateSession(id: string, patch: UpdateSessionRequest): Promise<ClientSession> {
    if (isLegacyId(id)) {
      throw new GatewayError('CS_INVALID_STATE', 'Phiên luồng cũ chỉ xem — không sửa được từ app này');
    }
    const dto = await csCall<BeClientSession>('/update', { id, ...sanitizeConfig(patch) });
    return mapClientSession(dto);
  },

  async doAction(id: string, action: SessionAction): Promise<ClientSession> {
    if (isLegacyId(id)) {
      if (action === 'submit') {
        throw new GatewayError('CS_INVALID_STATE', 'Phiên luồng cũ không có bước submit');
      }
      const { sessionId, sessionTimeMs } = parseCompositeId(id);
      await callOld<boolean>(LEGACY_ACTION_PATH[action], { sessionId, sessionTimeMs });
      // old API trả true và xử lý async — đọc lại trạng thái (best-effort, có thể trễ vài giây)
      return this.getSession(id);
    }
    const dto = await csCall<BeClientSession>(`/${action}`, { id });
    return mapClientSession(dto);
  },

  async addManualRows(id: string, req: ManualRowsRequest) {
    if (isLegacyId(id)) {
      throw new GatewayError('CS_INVALID_STATE', 'Phiên luồng cũ chỉ xem — không nạp thêm data được');
    }
    const result = await csCall<BeIngestResult>('/data/manual', {
      id,
      rows: req.rows,
      source: req.source ?? 'MANUAL',
      appendMode: req.appendMode,
    });
    const rows: DataRow[] = (result.rowOutcomes ?? []).map((o) => ({
      rowId: o.rowId,
      clientSessionId: id,
      phoneNumber: o.phoneNumber ?? '',
      source: req.source ?? 'MANUAL',
      rowStatus: o.status ?? 'STAGED',
      invalidReason: o.reason ?? null,
      priority: 0, // outcome không mang priority — bảng data sẽ refetch qua searchRows
      createdTimeMs: Date.now(),
    }));
    return {
      inserted: result.inserted ?? 0,
      duplicated: result.duplicated ?? 0,
      invalid: result.invalid ?? 0,
      rows,
    };
  },

  async searchRows(id: string, statuses?: string[]): Promise<DataRow[]> {
    if (isLegacyId(id)) {
      const { sessionId } = parseCompositeId(id);
      const page = await callOld<OldPaginated<OldRecordDTO>>('/record/search', {
        filter: { sessionIds: [sessionId] }, page: 1, size: 200,
      });
      return (page.items ?? []).map((r) => mapRecord(r, id));
    }
    const page = await csCall<BeDataPage>('/data/search', {
      id,
      rowStatuses: statuses && statuses.length ? statuses : undefined,
      size: 200,
    });
    return (page.rows ?? []).map((r) => mapClientRow(r, id));
  },

  async removeRows(id: string, rowIds: string[]): Promise<number> {
    if (isLegacyId(id)) {
      throw new GatewayError('CS_INVALID_STATE', 'Phiên luồng cũ chỉ xem — không xoá data được');
    }
    return csCall<number>('/data/delete', { id, rowIds });
  },

  async searchContacts(query: string): Promise<ContactSuggestion[]> {
    // B8 đợt 1: suggest theo SỐ ĐIỆN THOẠI (4-15 chữ số) — theo tên trả rỗng (B8b)
    const raw = await csCall<Array<{ id?: string; name?: string; phones?: string[] }>>(
      '/contact/suggest', { keyword: query });
    return (raw ?? []).map(mapContactSuggestion);
  },

  async setAppendMode(_id: string, _mode: AppendMode): Promise<void> {
    // real: appendMode truyền ngay trong request nạp data (docs 09 §6.3) — API riêng không tồn tại
  },

  // ============ Job nền + báo cáo (B5/B6/B7/B9/B10) ============

  async importExcel(id: string, file: File, appendMode?: AppendMode): Promise<ImportExcelResult> {
    requireClientSession(id, 'Import Excel');
    const form = new FormData();
    form.append('id', id);
    form.append('file', file, file.name);
    if (appendMode) form.append('appendMode', appendMode);
    const batch = mapImportBatch(await csUpload<BeImportBatch>('/data/import-excel', form));
    // BE parse nền: chưa có số liệu ngay, UI theo dõi qua importBatchId
    return {
      fileName: file.name,
      totalRows: 0, inserted: 0, duplicated: 0, invalid: 0, errors: [],
      importBatchId: batch.id,
      pending: true,
    };
  },

  async previewCrm(id: string, filter: CrmContactFilter): Promise<number> {
    requireClientSession(id, 'Xem trước danh bạ CRM');
    const result = await csCall<{ estimatedCount?: number }>('/data/import-crm/preview', { id, filter });
    return result?.estimatedCount ?? 0;
  },

  async importCrm(id: string, filter: CrmContactFilter, appendMode?: AppendMode): Promise<ImportBatch> {
    requireClientSession(id, 'Nạp danh bạ CRM');
    return mapImportBatch(await csCall<BeImportBatch>('/data/import-crm', { id, filter, appendMode }));
  },

  async listImportBatches(id: string): Promise<ImportBatch[]> {
    if (isLegacyId(id)) return []; // phiên luồng cũ không có khái niệm job nền
    const list = await csCall<BeImportBatch[]>('/import-batch/search', { id, size: 10 });
    return (list ?? []).map(mapImportBatch);
  },

  async recheckDedupe(id: string): Promise<ImportBatch> {
    requireClientSession(id, 'Tính lại trùng');
    return mapImportBatch(await csCall<BeImportBatch>('/data/recheck', { id }));
  },

  async updateRow(id: string, rowId: string, patch): Promise<DataRow> {
    requireClientSession(id, 'Sửa dòng data');
    return mapClientRow(await csCall<BeDataRow>('/data/update', { id, rowId, ...patch }), id);
  },

  async restoreDuplicate(id: string, rowId: string): Promise<DataRow> {
    requireClientSession(id, 'Khôi phục dòng trùng');
    return mapClientRow(await csCall<BeDataRow>('/data/restore-duplicate', { id, rowId }), id);
  },

  async report(id: string): Promise<SessionReport> {
    requireClientSession(id, 'Báo cáo phiên');
    return csCall<SessionReport>('/report/session', { id });
  },

  async exportData(id: string, rowStatuses?: string[]): Promise<ImportBatch> {
    requireClientSession(id, 'Xuất dữ liệu');
    return mapImportBatch(await csCall<BeImportBatch>('/export', { id, rowStatuses }));
  },

  subscribe(_id: string, _listener: (e: SessionEvent) => void): () => void {
    throw new GatewayError('CS_NOT_READY',
      'Realtime real-mode nối socket gateway ở C-03c — UI tự fallback poll 10s');
  },
};
