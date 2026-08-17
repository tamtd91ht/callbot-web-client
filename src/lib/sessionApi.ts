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
  AppendMode, CallbotScript, CallRecord, CallRecordFilter, ClientSession, CloneSessionRequest,
  CloneSessionResult, ContactSuggestion, CreateSessionRequest, CrmContactFilter,
  CustomerReportDetail, CustomerReportPage, CustomerReportPageRaw, CustomerReportQuery,
  CustomerReportSummary, DataRow,
  ImportBatch, ImportExcelResult, LegacySessionFilter, LegacySessionReport,
  Paginated, SessionReport, UpdateSessionRequest,
} from '@/contracts/types';
import {
  isLegacyId, mapCallRecord, mapClientRow, mapClientSession, mapContactSuggestion, mapImportBatch,
  mapOldRecord, mapOldSession, mapScript, parseCompositeId, sanitizeConfig, SUCCESS_CODE,
  type BeClientSession, type BeDataPage, type BeDataRow, type BeImportBatch, type BeIngestResult,
  type BeRecordDTO, type BeScriptDTO, type OldPaginated, type OldRecordDTO, type OldSessionDTO,
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

/**
 * Báo cáo khách hàng đọc THẲNG index gom trên backend thật — BFF simulator không dựng lại
 * index đó, nên mock mode không có gì để trả. Báo rõ ngay thay vì để UI gọi vào một route
 * BFF không tồn tại rồi hiện lỗi 404 khó hiểu.
 */
function requireRealMode(feature: string): void {
  if (!IS_REAL) {
    throw new ApiError('CS_INVALID_STATE',
      `${feature}: chỉ chạy ở chế độ real (đặt NEXT_PUBLIC_CALLBOT_MODE=real), mock không có index gom`);
  }
}

/** Phiên luồng cũ chỉ xem — chặn ngay ở FE cho thông báo rõ, không phí 1 vòng request. */
function requireClientSession(id: string, feature: string): void {
  if (isLegacyId(id)) {
    throw new ApiError('CS_INVALID_STATE', `${feature}: phiên luồng cũ chỉ xem, không thao tác được từ app này`);
  }
}

/**
 * Cửa sổ [fromDate, toDate] cho /record/search của luồng cũ.
 *
 * Hai ràng buộc của BE (CallBotFilter.validate) khiến hàm này buộc phải tồn tại:
 *  1. fromDate/toDate BẮT BUỘC — thiếu là ném thẳng "invalid time range", không có mặc định.
 *  2. So sánh là `fromDate >= toDate` → BẰNG NHAU CŨNG LỖI, nên không thể gửi
 *     from = to = mốc phiên. Phải nới ra hai bên.
 *
 * Điểm phản trực giác nhất: cặp mốc này KHÔNG phải "khoảng thời gian các cuộc gọi".
 * ES lọc range trên `sessionTimeMs` — thời điểm của PHIÊN, và mọi record trong phiên đều
 * mang cùng một giá trị đó. Vì vậy cửa sổ chỉ cần bao trọn đúng một điểm là mốc phiên;
 * nới rộng ra không lấy thêm được dòng nào, mà chỉ làm ES fan-out qua nhiều index tháng
 * (esIndices() chia index theo THÁNG). App production (web-v2 MACrudPreview) gửi đúng
 * sessionTimeMs ± 1ms — ở đây để ±1 phút cho chắc vì FE chỉ suy ra mốc phiên gián tiếp.
 *
 * Hệ quả: cửa sổ phải neo vào mốc PHIÊN, tuyệt đối không phải "N ngày gần đây" — phiên cũ
 * sẽ rơi ra ngoài và trả 0 dòng, im lặng, trông y hệt "phiên chưa gọi ai".
 */
function recordSearchWindow(session: ClientSession): { fromDate: number; toDate: number } {
  // submittedTimeMs là lúc phiên thực sự vào engine — sát `sessionTimeMs` nhất.
  // startTimeMs (giờ hẹn) chỉ dùng khi đã QUA: giờ hẹn tương lai không thể là mốc của
  // record nào cả (phiên chưa chạy), mà còn kéo cửa sổ ra khỏi vùng hợp lệ sau khi BE kẹp.
  const scheduled = session.startTimeMs && session.startTimeMs <= Date.now() ? session.startTimeMs : null;
  const anchor = session.submittedTimeMs || scheduled || session.createdTimeMs || Date.now();
  const PAD_MS = 60_000;
  // BẪY: BE kẹp toDate về now TRƯỚC khi so sánh (CallBotFilter.validate). Phiên hẹn giờ
  // tương lai mà gửi cả cặp mốc tương lai → toDate tụt về now → fromDate >= toDate → lại
  // đúng lỗi "invalid time range". Nên tự kẹp trước, rồi ép fromDate luôn nhỏ hơn toDate.
  const toDate = Math.min(anchor + PAD_MS, Date.now());
  return { fromDate: Math.min(anchor - PAD_MS, toDate - PAD_MS), toDate };
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

  /**
   * `cause` chỉ có nghĩa với pause/cancel (BE đọc key `cause`); submit/resume bỏ qua.
   * BE KHÔNG hỗ trợ pause kèm thời lượng như AutoCall (pauseUntilTime) — xem mục nợ BE.
   */
  async action(
    id: string,
    action: 'submit' | 'pause' | 'resume' | 'cancel',
    cause?: string,
  ): Promise<ClientSession> {
    if (!IS_REAL) return post<ClientSession>(`/api/client-session/${id}/${action}`, cause ? { cause } : undefined);
    if (isLegacyId(id)) {
      if (action === 'submit') throw new ApiError('CS_INVALID_STATE', 'Phiên luồng cũ không có bước submit');
      const { sessionId, sessionTimeMs } = parseCompositeId(id);
      const path = action === 'resume' ? '/session/continue' : `/session/${action}`; // old API gọi resume là "continue"
      await beCall<boolean>(path, { sessionId, sessionTimeMs });
      return this.getById(id); // old API xử lý async, đọc lại trạng thái
    }
    const body: Record<string, unknown> = { id };
    if (cause && (action === 'pause' || action === 'cancel')) body.cause = cause;
    return mapClientSession(await cs<BeClientSession>(`/${action}`, body));
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

  /**
   * Báo cáo khách hàng (A-05) — MỘT KH = MỘT DÒNG, khác `report()` vốn đếm theo CUỘC.
   *
   * KHÔNG gọi requireClientSession: đây là API ĐỌC từ index gom, khoá gom là
   * tenantId+sessionId+phoneNumber nên phiên LUỒNG CŨ cũng có dòng. Chặn ở đây là tự bịt
   * mất đúng nhóm phiên mà báo cáo này sinh ra để phục vụ.
   */
  async customerReport(query: CustomerReportQuery): Promise<CustomerReportPage> {
    requireRealMode('Báo cáo khách hàng');
    const raw = await cs<CustomerReportPageRaw>('/report/customer/list', query);
    // BE trả khuôn phân trang chuẩn của hệ (Paginated) — field snake_case: items/total_items/...
    // Quy về camelCase ngay tại đây để UI không phải biết chuyện đó.
    // BE bỏ field null (@JsonInclude NON_NULL) → items/nextCursor có thể VẮNG MẶT chứ không phải null.
    return {
      data: raw?.items ?? [],
      total: raw?.total_items ?? 0,
      nextCursor: raw?.nextCursor ?? null,
      size: raw?.page_size ?? (query.size ?? 20),
      pageNumber: raw?.page_number ?? (query.page ?? 1),
      totalPages: raw?.total_pages ?? 0,
      // hasNext của BE tính theo CÒN CURSOR hay không (chuẩn hơn phép chia total/size:
      // trang cuối vẫn có thể đủ size dòng). Thiếu field thì suy lại từ cursor, không từ số trang.
      hasNext: raw?.has_next ?? raw?.nextCursor != null,
      hasPrevious: raw?.has_previous ?? false,
    };
  },

  /**
   * Danh sách phiên LUỒNG CŨ (CallBotHandler) — `POST /session/search`.
   * Khác `list()`: gọi RIÊNG luồng cũ, và BE **thật sự đọc filter** nên lọc chạy phía server.
   * Trả kèm `total` để phân trang server-side (luồng mới không có).
   */
  async legacyList(filter: LegacySessionFilter): Promise<Paginated<ClientSession>> {
    requireRealMode('Danh sách phiên luồng cũ');
    const { page = 1, size = 20, ...rest } = filter;
    const raw = await beCall<OldPaginated<OldSessionDTO>>('/session/search',
      { filter: rest, page, size });
    return {
      items: (raw?.items ?? []).map(mapOldSession),
      total: raw?.total_items ?? raw?.totalItems ?? 0,
    };
  },

  /**
   * Tổng hợp báo cáo phiên luồng cũ — `POST /session/report`.
   * Mẫu số là CUỘC GỌI. Body là filter TRẦN (không bọc trong `{filter}` như `/session/search`)
   * vì controller đọc thẳng `ctx.body()` thành `CallBotSessionFilter`.
   */
  async legacyReport(filter: Omit<LegacySessionFilter, 'page' | 'size'>): Promise<LegacySessionReport> {
    requireRealMode('Báo cáo phiên luồng cũ');
    const raw = await beCall<Partial<LegacySessionReport>>('/session/report', filter);
    // Không có phiên nào khớp thì BE trả object builder RỖNG (mọi field @Builder.Default = 0),
    // nhưng @JsonInclude(NON_NULL) vẫn có thể lược bớt → chuẩn hoá về 0.
    return {
      totalSession: raw?.totalSession ?? 0,
      totalRecord: raw?.totalRecord ?? 0,
      totalAnswered: raw?.totalAnswered ?? 0,
      totalNoAnswer: raw?.totalNoAnswer ?? 0,
      totalFailed: raw?.totalFailed ?? 0,
      totalCanceled: raw?.totalCanceled ?? 0,
      totalProcessing: raw?.totalProcessing ?? 0,
    };
  },

  /**
   * Ô tổng hợp của báo cáo KH. Gửi ĐÚNG bộ lọc đang dùng cho danh sách thì số trên ô mới khớp
   * bảng bên dưới — BE dùng chung hàm dựng query cho cả hai endpoint.
   * `cursor`/`size`/`sort*` không có ý nghĩa ở đây nên bỏ đi cho khỏi hiểu nhầm.
   */
  async customerReportSummary(
    query: Omit<CustomerReportQuery, 'cursor' | 'size' | 'sortField' | 'sortAsc'>,
  ): Promise<CustomerReportSummary> {
    requireRealMode('Tổng hợp báo cáo khách hàng');
    const raw = await cs<Partial<CustomerReportSummary>>('/report/customer/summary', query);
    // Index rỗng thì BE trả map RỖNG (return sớm), không phải map đủ key với số 0.
    return {
      totalCustomers: raw?.totalCustomers ?? 0,
      totalRecord: raw?.totalRecord ?? 0,
      totalCall: raw?.totalCall ?? 0,
      totalAnswered: raw?.totalAnswered ?? 0,
      totalNoAnswer: raw?.totalNoAnswer ?? 0,
      totalFailed: raw?.totalFailed ?? 0,
      totalBillSec: raw?.totalBillSec ?? 0,
      avgBillSec: raw?.avgBillSec ?? null,
      totalAnswerSec: raw?.totalAnswerSec ?? 0,
      avgAnswerSec: raw?.avgAnswerSec ?? null,
      avgRingingTimeMs: raw?.avgRingingTimeMs ?? null,
      avgTalkTimeMs: raw?.avgTalkTimeMs ?? null,
      byBestStatus: raw?.byBestStatus ?? {},
      answeredCustomers: raw?.answeredCustomers ?? 0,
      answerRateByCustomer: raw?.answerRateByCustomer ?? 0,
    };
  },

  /**
   * Chi tiết 1 KH — bung `attempts[]`. Cả 3 tham số đều BẮT BUỘC ở BE;
   * `sessionTimeMs` là mốc neo index theo năm, thiếu là CS_INVALID_CONFIG.
   */
  async customerReportDetail(
    sessionId: string, sessionTimeMs: number, phoneNumber: string,
  ): Promise<CustomerReportDetail | null> {
    requireRealMode('Chi tiết khách hàng');
    return cs<CustomerReportDetail | null>('/report/customer/detail',
      { sessionId, sessionTimeMs, phoneNumber });
  },

  async searchContacts(query: string): Promise<ContactSuggestion[]> {
    if (!IS_REAL) return get<ContactSuggestion[]>(`/api/contacts/search?q=${encodeURIComponent(query)}`);
    // B8 đợt 1: BE suggest theo SỐ ĐIỆN THOẠI (4-15 chữ số); theo tên là ticket B8b
    const raw = await cs<Array<{ id?: string; name?: string; phones?: string[] }>>(
      '/contact/suggest', { keyword: query });
    return (raw ?? []).map(mapContactSuggestion);
  },

  /**
   * Nhân bản phiên — tương đương "Gọi lại phiên" của AutoCall (4 cloneTypes).
   * Trả về phiên DRAFT mới + job nền copy data (nếu có mang data sang).
   */
  async clone(req: CloneSessionRequest): Promise<CloneSessionResult> {
    if (!IS_REAL) return post<CloneSessionResult>('/api/client-session/clone', req);
    requireClientSession(req.sourceSessionId, 'Nhân bản phiên');
    const raw = await cs<{ session?: BeClientSession; importBatchId?: string | null }>('/clone', {
      sourceSessionId: req.sourceSessionId,
      copyConfig: req.copyConfig,
      dataFilter: req.dataFilter ?? null,
      overrides: req.overrides ? sanitizeConfig(req.overrides) : null,
      name: req.name,
    });
    if (!raw?.session) throw new ApiError('CS_UPSTREAM_ERROR', 'Backend không trả về phiên sau khi nhân bản');
    return { session: mapClientSession(raw.session), importBatchId: raw.importBatchId ?? null };
  },

  /**
   * Lịch sử cuộc gọi thực tế của phiên (khác data staging: 1 dòng data retry 3 lần → 3 record).
   * Dùng endpoint luồng cũ /record/search vì luồng client mới CHƯA có endpoint riêng —
   * runtimeSessionId ("cs_<id>") chính là cầu nối sang engine cũ.
   */
  async searchRecords(session: ClientSession, filter: CallRecordFilter = {}): Promise<Paginated<CallRecord>> {
    const page = filter.page ?? 1;
    const size = filter.size ?? 20;
    if (!IS_REAL) {
      return get<Paginated<CallRecord>>(
        `/api/client-session/${session.id}/records?page=${page}&size=${size}`
        + `${filter.statuses?.length ? `&statuses=${filter.statuses.join(',')}` : ''}`
        + `${filter.keyword ? `&keyword=${encodeURIComponent(filter.keyword)}` : ''}`,
      );
    }
    // Phiên luồng cũ dùng id gốc; phiên mới phải dùng runtimeSessionId (chưa submit thì chưa có record)
    const runtimeId = isLegacyId(session.id)
      ? parseCompositeId(session.id).sessionId
      : session.runtimeSessionId;
    if (!runtimeId) return { items: [], total: 0 };

    // BE (CallBotFilter.validate) BẮT BUỘC fromDate/toDate: thiếu một trong hai, hoặc
    // fromDate >= toDate, là ném thẳng "invalid time range" — không phải cảnh báo, là chặn.
    // Nên dù UI không có ô chọn ngày, FE vẫn phải tự suy ra cửa sổ thời gian.
    //
    // Cửa sổ phải bám theo PHIÊN, không phải "N ngày gần đây": ES lọc trên `sessionTimeMs`
    // (thời điểm phiên), nên phiên tạo từ tháng trước sẽ rơi ra ngoài cửa sổ tương đối và
    // trả về 0 dòng — im lặng, trông y hệt "phiên chưa gọi ai", rất khó lần.
    const { fromDate, toDate } = recordSearchWindow(session);

    const beFilter: Record<string, unknown> = { sessionIds: [runtimeId], fromDate, toDate };
    // BE đặt tên field là `status` (CallBotRecordFilter), KHÔNG phải `statuses` như CallRecordFilter
    // của FE. Gửi sai tên thì @JsonIgnoreProperties(ignoreUnknown = true) nuốt im lặng →
    // bấm tab trạng thái nào cũng ra cùng một danh sách.
    if (filter.statuses?.length) beFilter.status = filter.statuses;
    if (filter.sipNumbers?.length) beFilter.sipNumbers = filter.sipNumbers;
    if (filter.keyword?.trim()) beFilter.keyword = filter.keyword.trim();

    const result = await beCall<OldPaginated<BeRecordDTO>>('/record/search', { filter: beFilter, page, size });
    return {
      items: (result.items ?? []).map(mapCallRecord),
      total: result.total_items ?? result.totalItems ?? (result.items ?? []).length,
    };
  },

  /** Chi tiết 1 cuộc gọi (transcript, phân tích) — cần cả recordId và callIndexTimeMs. */
  async recordCallInfo(recordId: string, callIndexTimeMs: number | null): Promise<unknown> {
    if (!IS_REAL) return get<unknown>(`/api/records/${recordId}`);
    return beCall<unknown>('/record/call-info', { recordId, callIndexTimeMs });
  },

  /** Danh sách kịch bản (bản mới nhất) để chọn khi tạo phiên. */
  async listScripts(keyword?: string): Promise<CallbotScript[]> {
    if (!IS_REAL) return get<CallbotScript[]>('/api/scripts');
    const raw = await beCall<BeScriptDTO[] | OldPaginated<BeScriptDTO>>(
      '/filter/script/newest-version/list',
      { page: 1, size: 100, ...(keyword?.trim() ? { keyword: keyword.trim() } : {}) },
    );
    const items = Array.isArray(raw) ? raw : raw?.items ?? [];
    return items.map(mapScript);
  },

  /** Tra tên/biến kịch bản đã lưu trên phiên (drawer "Xem chi tiết kịch bản"). */
  async scriptsByUuids(uuids: string[]): Promise<CallbotScript[]> {
    if (uuids.length === 0) return [];
    if (!IS_REAL) return get<CallbotScript[]>(`/api/scripts?uuids=${uuids.join(',')}`);
    const raw = await beCall<BeScriptDTO[] | OldPaginated<BeScriptDTO>>(
      '/filter/script/list-by-uuids', { uuids });
    const items = Array.isArray(raw) ? raw : raw?.items ?? [];
    return items.map(mapScript);
  },

  /** Link tải file Excel template dựng theo biến của kịch bản đã chọn. */
  async importTemplateUrl(id: string): Promise<string | null> {
    if (!IS_REAL) return null;
    requireClientSession(id, 'Tải template Excel');
    const raw = await cs<{ url?: string }>('/data/import-template', { id });
    return raw?.url ?? null;
  },
};
