'use client';
/**
 * Facade DUY NHẤT mà UI dùng để gọi API phiên. Hai đường tuỳ mode:
 *
 *  - real (NEXT_PUBLIC_CALLBOT_MODE=real): trình duyệt gọi **THẲNG** callbot-service stg
 *    (quyết định owner 2026-08-04). Network tab thấy đúng domain thật; không qua BFF.
 *    Token Bearer lấy từ localStorage (lib/token.ts), BE cho phép CORS `*`.
 *  - mock: gọi Route Handler /api/* của BFF (simulator in-memory) — vẫn dùng để demo không cần backend.
 *
 * UI KHÔNG tự dựng URL: mọi endpoint nằm ở đây để đổi mode/đổi path chỉ sửa 1 chỗ.
 */
import type {
  AppendMode, ClientSession, ContactSuggestion, CreateSessionRequest, CrmContactFilter, DataRow,
  ImportBatch, ImportExcelResult, SessionReport, UpdateSessionRequest,
} from '@/contracts/types';
import {
  isLegacyId, mapClientRow, mapClientSession, mapContactSuggestion, mapImportBatch,
  mapOldRecord, mapOldSession, parseCompositeId, sanitizeConfig, SUCCESS_CODE,
  type BeClientSession, type BeDataPage, type BeDataRow, type BeImportBatch, type BeIngestResult,
  type OldPaginated, type OldRecordDTO, type OldSessionDTO,
} from '@/contracts/mappers';
import { errorMessage } from '@/contracts/errorCodes';
import { ApiError, api, get, post, patch, del } from './apiClient';
import { getToken } from './token';

export const IS_REAL = process.env.NEXT_PUBLIC_CALLBOT_MODE === 'real';

/** Base URL phải là biến NEXT_PUBLIC_* vì trình duyệt cần đọc được. */
export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_CALLBOT_BASE_URL || 'https://callbot-v2-stg.omicrm.com/call-bot')
    .replace(/\/$/, '');
}

/* ============================ Transport gọi thẳng BE ============================ */

function authHeader(): Record<string, string> {
  const token = getToken();
  if (!token) {
    throw new ApiError('CS_UNAUTHORIZED',
      errorMessage('CS_UNAUTHORIZED', 'Chưa có token — bấm nút "Token" trên thanh header để dán JWT'));
  }
  return { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };
}

/** Bóc envelope BE + dịch prefix "CS_XXX: ..." thành ApiError có errorCode. */
async function unwrap<T>(res: Response): Promise<T> {
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('CS_UNAUTHORIZED',
      errorMessage('CS_UNAUTHORIZED', 'Token hết hạn hoặc không hợp lệ — dán token mới'));
  }
  const text = await res.text();
  let envelope: { status_code?: number; statusCode?: number; message?: string; payload?: T };
  try {
    envelope = JSON.parse(text) as typeof envelope;
  } catch {
    // 404 của Vert.x trả HTML — thường là service chưa deploy bản có router client-session
    throw new ApiError('CS_BAD_GATEWAY',
      `Backend trả về không phải JSON (HTTP ${res.status}). Kiểm tra service stg đã deploy bản mới chưa.`);
  }
  if ((envelope.status_code ?? envelope.statusCode) !== SUCCESS_CODE) {
    const raw = envelope.message || `Lỗi backend (code ${envelope.status_code ?? envelope.statusCode})`;
    const prefixed = /^(CS_[A-Z_]+):\s*(.*)$/s.exec(raw);
    if (prefixed) throw new ApiError(prefixed[1], errorMessage(prefixed[1], prefixed[2] || raw));
    throw new ApiError('CS_UPSTREAM_ERROR', raw);
  }
  return envelope.payload as T;
}

async function beCall<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  });
  return unwrap<T>(res);
}

/** Upload multipart: KHÔNG set Content-Type để browser tự thêm boundary. */
async function beUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST', headers: authHeader(), body: form, cache: 'no-store',
  });
  return unwrap<T>(res);
}

const cs = <T>(path: string, body: unknown) => beCall<T>(`/client-session${path}`, body);

/** Phiên luồng cũ chỉ xem — chặn ngay ở FE cho thông báo rõ, không phí 1 vòng request. */
function requireClientSession(id: string, feature: string): void {
  if (isLegacyId(id)) {
    throw new ApiError('CS_INVALID_STATE', `${feature}: phiên luồng cũ chỉ xem, không thao tác được từ app này`);
  }
}

/* ============================ Các nghiệp vụ ============================ */

export const sessionApi = {
  async create(req: CreateSessionRequest): Promise<ClientSession> {
    if (!IS_REAL) return post<ClientSession>('/api/client-session', req);
    return mapClientSession(await cs<BeClientSession>('/create', sanitizeConfig(req)));
  },

  async list(): Promise<ClientSession[]> {
    if (!IS_REAL) return get<ClientSession[]>('/api/client-session');
    // phiên client mới là chính; phiên luồng cũ append best-effort (JWT có quyền mới thấy)
    const [fresh, legacy] = await Promise.allSettled([
      cs<BeClientSession[]>('/search', { page: 1, size: 50 }),
      beCall<OldPaginated<OldSessionDTO>>('/session/search', { filter: {}, page: 1, size: 50 }),
    ]);
    if (fresh.status === 'rejected') throw fresh.reason;
    const result = (fresh.value ?? []).map(mapClientSession);
    if (legacy.status === 'fulfilled') result.push(...(legacy.value.items ?? []).map(mapOldSession));
    return result;
  },

  async getById(id: string): Promise<ClientSession> {
    if (!IS_REAL) return get<ClientSession>(`/api/client-session/${id}`);
    if (isLegacyId(id)) {
      const { sessionId, sessionTimeMs } = parseCompositeId(id);
      const dto = await beCall<OldSessionDTO>('/session/get-by-id', { sessionId, sessionTimeMs });
      if (!dto) throw new ApiError('CS_NOT_FOUND', `Không tìm thấy phiên ${sessionId}`);
      return mapOldSession(dto);
    }
    return mapClientSession(await cs<BeClientSession>('/get-by-id', { id }));
  },

  async update(id: string, patchBody: UpdateSessionRequest): Promise<ClientSession> {
    if (!IS_REAL) return api<ClientSession>(`/api/client-session/${id}`, {
      method: 'PATCH', body: JSON.stringify(patchBody),
    });
    requireClientSession(id, 'Cập nhật cấu hình');
    return mapClientSession(await cs<BeClientSession>('/update', { id, ...sanitizeConfig(patchBody) }));
  },

  async action(id: string, action: 'submit' | 'pause' | 'resume' | 'cancel'): Promise<ClientSession> {
    if (!IS_REAL) return post<ClientSession>(`/api/client-session/${id}/${action}`);
    if (isLegacyId(id)) {
      if (action === 'submit') throw new ApiError('CS_INVALID_STATE', 'Phiên luồng cũ không có bước submit');
      const { sessionId, sessionTimeMs } = parseCompositeId(id);
      const path = action === 'resume' ? '/session/continue' : `/session/${action}`; // old API gọi resume là "continue"
      await beCall<boolean>(path, { sessionId, sessionTimeMs });
      return this.getById(id); // old API xử lý async, đọc lại trạng thái
    }
    return mapClientSession(await cs<BeClientSession>(`/${action}`, { id }));
  },

  async searchRows(id: string): Promise<DataRow[]> {
    if (!IS_REAL) return get<DataRow[]>(`/api/client-session/${id}/data`);
    if (isLegacyId(id)) {
      const { sessionId } = parseCompositeId(id);
      const page = await beCall<OldPaginated<OldRecordDTO>>('/record/search', {
        filter: { sessionIds: [sessionId] }, page: 1, size: 200,
      });
      return (page.items ?? []).map((r) => mapOldRecord(r, id));
    }
    const page = await cs<BeDataPage>('/data/search', { id, size: 200 });
    return (page.rows ?? []).map((r) => mapClientRow(r, id));
  },

  async addRows(id: string, rows: Array<{ phoneNumber: string; variables?: Record<string, string> }>,
    source: 'MANUAL' | 'EXCEL' | 'CRM', appendMode?: AppendMode,
  ): Promise<{ inserted: number; duplicated: number; invalid: number }> {
    if (!IS_REAL) return post(`/api/client-session/${id}/data`, { rows, source, appendMode });
    requireClientSession(id, 'Nạp dữ liệu');
    const result = await cs<BeIngestResult>('/data/manual', { id, rows, source, appendMode });
    return {
      inserted: result.inserted ?? 0,
      duplicated: result.duplicated ?? 0,
      invalid: result.invalid ?? 0,
    };
  },

  async removeRows(id: string, rowIds: string[]): Promise<number> {
    if (!IS_REAL) return del<number>(`/api/client-session/${id}/data`, { rowIds });
    requireClientSession(id, 'Xoá dòng dữ liệu');
    return cs<number>('/data/delete', { id, rowIds });
  },

  async updateRow(id: string, rowId: string, phoneNumber: string): Promise<DataRow> {
    if (!IS_REAL) return patch<DataRow>(`/api/client-session/${id}/rows`, { rowId, phoneNumber });
    requireClientSession(id, 'Sửa dòng dữ liệu');
    return mapClientRow(await cs<BeDataRow>('/data/update', { id, rowId, phoneNumber }), id);
  },

  async restoreDuplicate(id: string, rowId: string): Promise<DataRow> {
    if (!IS_REAL) return post<DataRow>(`/api/client-session/${id}/rows`, { rowId });
    requireClientSession(id, 'Khôi phục dòng trùng');
    return mapClientRow(await cs<BeDataRow>('/data/restore-duplicate', { id, rowId }), id);
  },

  async importExcel(id: string, file: File, appendMode?: AppendMode): Promise<ImportExcelResult> {
    if (!IS_REAL) {
      const form = new FormData();
      form.append('file', file);
      if (appendMode) form.append('appendMode', appendMode);
      return api<ImportExcelResult>(`/api/client-session/${id}/data/import-excel`, {
        method: 'POST', body: form,
      });
    }
    requireClientSession(id, 'Import Excel');
    const form = new FormData();
    form.append('id', id);
    form.append('file', file, file.name);
    if (appendMode) form.append('appendMode', appendMode);
    const batch = mapImportBatch(await beUpload<BeImportBatch>('/client-session/data/import-excel', form));
    // BE parse nền → chưa có số liệu, UI theo dõi qua importBatchId
    return {
      fileName: file.name, totalRows: 0, inserted: 0, duplicated: 0, invalid: 0, errors: [],
      importBatchId: batch.id, pending: true,
    };
  },

  async listJobs(id: string): Promise<ImportBatch[]> {
    if (!IS_REAL) return get<ImportBatch[]>(`/api/client-session/${id}/jobs`);
    if (isLegacyId(id)) return []; // phiên luồng cũ không có khái niệm job nền
    const list = await cs<BeImportBatch[]>('/import-batch/search', { id, size: 10 });
    return (list ?? []).map(mapImportBatch);
  },

  async recheckDedupe(id: string): Promise<ImportBatch> {
    if (!IS_REAL) return post<ImportBatch>(`/api/client-session/${id}/jobs`, { action: 'recheck' });
    requireClientSession(id, 'Tính lại trùng');
    return mapImportBatch(await cs<BeImportBatch>('/data/recheck', { id }));
  },

  async exportData(id: string, rowStatuses?: string[]): Promise<ImportBatch> {
    if (!IS_REAL) return post<ImportBatch>(`/api/client-session/${id}/jobs`, { action: 'export', rowStatuses });
    requireClientSession(id, 'Xuất dữ liệu');
    return mapImportBatch(await cs<BeImportBatch>('/export', { id, rowStatuses }));
  },

  async previewCrm(id: string, filter: CrmContactFilter): Promise<number> {
    if (!IS_REAL) {
      const data = await post<{ estimatedCount: number }>(
        `/api/client-session/${id}/jobs`, { action: 'preview-crm', filter });
      return data.estimatedCount;
    }
    requireClientSession(id, 'Xem trước danh bạ CRM');
    const result = await cs<{ estimatedCount?: number }>('/data/import-crm/preview', { id, filter });
    return result?.estimatedCount ?? 0;
  },

  async importCrm(id: string, filter: CrmContactFilter, appendMode?: AppendMode): Promise<ImportBatch> {
    if (!IS_REAL) return post<ImportBatch>(`/api/client-session/${id}/jobs`,
      { action: 'import-crm', filter, appendMode });
    requireClientSession(id, 'Nạp danh bạ CRM');
    return mapImportBatch(await cs<BeImportBatch>('/data/import-crm', { id, filter, appendMode }));
  },

  async report(id: string): Promise<SessionReport> {
    if (!IS_REAL) return get<SessionReport>(`/api/client-session/${id}/report`);
    requireClientSession(id, 'Báo cáo phiên');
    return cs<SessionReport>('/report/session', { id });
  },

  async searchContacts(query: string): Promise<ContactSuggestion[]> {
    if (!IS_REAL) return get<ContactSuggestion[]>(`/api/contacts/search?q=${encodeURIComponent(query)}`);
    // B8 đợt 1: BE suggest theo SỐ ĐIỆN THOẠI (4-15 chữ số); theo tên là ticket B8b
    const raw = await cs<Array<{ id?: string; name?: string; phones?: string[] }>>(
      '/contact/suggest', { keyword: query });
    return (raw ?? []).map(mapContactSuggestion);
  },
};
