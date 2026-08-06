/**
 * CallbotGateway — cổng duy nhất BFF nói chuyện với "backend" (mirror docs 05).
 * 2 implementation:
 *   - MockGateway  : simulator in-memory, mô phỏng ĐÚNG state machine docs 01 §4 + dispatcher docs 03
 *   - RealGateway  : proxy REST sang callbot-service (bật khi BE B8 xong — CALLBOT_MODE=real)
 * FE/route handlers KHÔNG được import mock/real trực tiếp — chỉ qua getGateway().
 */
import type {
  AppendMode, CallbotScript, CallRecord, CallRecordFilter, ClientSession, CloneSessionRequest,
  CloneSessionResult, ContactSuggestion, CreateSessionRequest, CrmContactFilter, DataRow,
  ImportBatch, ImportExcelResult, ManualRowsRequest, Paginated, SessionReport, UpdateSessionRequest,
} from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';

export class GatewayError extends Error {
  constructor(public readonly errorCode: string, message: string) {
    super(message);
  }
}

export type SessionAction = 'submit' | 'pause' | 'resume' | 'cancel';

export interface CallbotGateway {
  createSession(req: CreateSessionRequest): Promise<ClientSession>;
  listSessions(): Promise<ClientSession[]>;
  getSession(id: string): Promise<ClientSession>;
  /** PATCH config — nhóm core chỉ khi DRAFT (docs 01 §5). */
  updateSession(id: string, patch: UpdateSessionRequest): Promise<ClientSession>;
  /** `cause` chỉ dùng cho pause/cancel — BE lưu vào pausedCause/cancelCause. */
  doAction(id: string, action: SessionAction, cause?: string): Promise<ClientSession>;
  addManualRows(id: string, req: ManualRowsRequest): Promise<{ inserted: number; duplicated: number; invalid: number; rows: DataRow[] }>;
  searchRows(id: string, statuses?: string[]): Promise<DataRow[]>;
  /** Xoá rows (chỉ STAGED/DUPLICATE/INVALID → REMOVED). */
  removeRows(id: string, rowIds: string[]): Promise<number>;
  /** Autocomplete contact CRM cho drawer Thủ công (mock; real qua API contact). */
  searchContacts(query: string): Promise<ContactSuggestion[]>;
  setAppendMode(id: string, mode: AppendMode): Promise<void>;

  // ===== Job nền + báo cáo (B5/B6/B7/B9/B10) =====
  /**
   * Real: đẩy nguyên file lên BE, parse chạy nền → trả `{importBatchId, pending:true}`.
   * Mock: BFF tự parse tại chỗ nên trả kết quả đầy đủ ngay.
   */
  importExcel(id: string, file: File, appendMode?: AppendMode): Promise<ImportExcelResult>;
  /** Số contact khớp filter — hỏi trước khi user chốt nạp. */
  previewCrm(id: string, filter: CrmContactFilter): Promise<number>;
  importCrm(id: string, filter: CrmContactFilter, appendMode?: AppendMode): Promise<ImportBatch>;
  /** Các đợt xử lý nền của phiên — FE poll để hiện tiến độ / lấy link file. */
  listImportBatches(id: string): Promise<ImportBatch[]>;
  /** Tính lại trùng sau khi đổi cách check trùng (chỉ ở DRAFT). */
  recheckDedupe(id: string): Promise<ImportBatch>;
  updateRow(id: string, rowId: string, patch: { phoneNumber?: string; variables?: Record<string, string> }): Promise<DataRow>;
  /** Ép 1 dòng DUPLICATE về STAGED — chấp nhận gọi cả hai dòng trùng. */
  restoreDuplicate(id: string, rowId: string): Promise<DataRow>;
  report(id: string): Promise<SessionReport>;
  exportData(id: string, rowStatuses?: string[]): Promise<ImportBatch>;

  // ===== Parity AutoCall: lịch sử cuộc gọi, nhân bản phiên, danh mục kịch bản =====
  /**
   * Lịch sử cuộc gọi THỰC TẾ (1 dòng data retry 3 lần → 3 record) — khác searchRows là
   * data staging. Tương đương bảng lịch sử gọi ở màn chi tiết phiên AutoCall.
   */
  searchRecords(id: string, filter: CallRecordFilter): Promise<Paginated<CallRecord>>;
  /** Nhân bản phiên — tương đương "Gọi lại phiên" của AutoCall. */
  cloneSession(req: CloneSessionRequest): Promise<CloneSessionResult>;
  /** Danh mục kịch bản (mock mode; real mode FE gọi thẳng gateway chatbot). */
  listScripts(): Promise<CallbotScript[]>;
  /** Đăng ký nhận realtime events của 1 phiên (mock: từ simulator; real: C-03 sẽ chuyển FE nối socket trực tiếp). */
  subscribe(id: string, listener: (e: SessionEvent) => void): () => void;
}

import { mockGateway } from './mock/mockGateway';

/**
 * BFF giờ CHỈ phục vụ mock mode: real mode trình duyệt gọi thẳng callbot-service stg
 * (quyết định owner 2026-08-04 — xem lib/sessionApi.ts). Giữ 1 đường duy nhất cho real
 * để không có 2 bản logic map envelope/mã lỗi tự trôi khỏi nhau.
 */
export function getGateway(): CallbotGateway {
  return mockGateway;
}
