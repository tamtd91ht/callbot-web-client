/**
 * MIRROR của contract backend — docs/client-session/05-api-contract.md + 09-client-integration-guide.md
 * (repo cloud-vihat-saas-omicrm-callbot-service). Đây là NGUỒN SỰ THẬT phía FE:
 * đổi contract BE → đổi file này + ghi CHANGELOG bên repo BE.
 */

export type ClientSessionStatus =
  | 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELED';

export type ClientRowStatus =
  | 'STAGED' | 'DUPLICATE' | 'INVALID' | 'QUEUED' | 'DISPATCHED' | 'DONE' | 'REMOVED';

export type ClientDataSource =
  | 'MANUAL' | 'EXCEL' | 'CRM' | 'THIRD_PARTY' | 'CLONE'
  // nguồn LUỒNG CŨ — chỉ xuất hiện khi real mode xem phiên cũ trên stg (read-only)
  | 'WEB' | 'API' | 'CAMPAIGN';
export type DedupeMode = 'NONE' | 'PHONE' | 'FIELD';
/**
 * Điều kiện kích hoạt gọi lại. Thay cho bản cũ `'NO_ANSWER' | 'BOT_ACTION'` (đổi 2026-08-10):
 * điều kiện cụ thể tụt xuống `actionCodes` (list string MỞ) để thêm mã mới không phải đổi type.
 * `NO_ANSWER` vì thế giờ là một GIÁ TRỊ của actionCodes, không còn là trigger.
 * CONTACT_* mới là khung ở BE — chưa gọi lại lần nào, đừng mở cho người dùng chọn.
 */
export type RetryTrigger = 'CALL_STATUS' | 'CONTACT_ATTRIBUTE' | 'CONTACT_STATUS';
export type VariablePriority = 'SESSION_DATA_FIRST' | 'CRM_CONTACT_FIRST';
export type AppendMode = 'RUN_NOW' | 'RUN_AFTER';

/**
 * [FR-004] Khung giờ + ngày trong tuần PER-SLOT. daysOfWeek theo ISO: 1=T2 … 7=CN;
 * không gửi / rỗng = mọi ngày (BE tương thích ngược — đừng dùng [] với nghĩa "slot tắt").
 */
export interface TimeSlot { from: string; to: string; daysOfWeek?: number[] } // "HH:mm"

export interface SipNumber {
  number: string;
  gateway?: string;
  network?: string;
  isRoutingNumber?: boolean;
}

export interface RetryConfig {
  trigger: RetryTrigger;
  actionCodes?: string[];
  maxRetry: number;
  delaySeconds: number;
}

export interface DedupeConfig { mode: DedupeMode; fieldId?: string | null; }

export interface SessionCounters {
  total: number;
  staged: number;
  duplicated: number;
  invalid: number;
  queued: number;
  dispatched: number;
  remaining: number;
  answered: number;
  noAnswer: number;
  failed: number;
  canceled: number;
  totalRecords: number;
  retried: number;
}

export interface ClientSession {
  id: string;
  tenantId: string;
  name: string;
  purpose?: string;
  status: ClientSessionStatus;
  startTimeMs?: number | null;
  timeSlots?: TimeSlot[];
  timezoneId?: string;
  sipNumbers: SipNumber[];
  scriptId?: string;
  scriptUuid?: string;
  voiceOverride?: string | null;
  retryConfig?: RetryConfig | null;
  /** [FR-008] Ngắt cuộc nếu không kết nối sau N giây (5–60); null = mặc định tổng đài (60s). */
  ringTimeoutSeconds?: number | null;
  /**
   * [XFuture] Cắt cuộc sau N giây tính TỪ LÚC KẾT NỐI (30–3600); null = không giới hạn.
   * Khác ringTimeoutSeconds vốn chỉ giới hạn thời gian ĐỔ CHUÔNG.
   * ⚠️ Wrapper CHƯA đọc field này — callbot-service đẩy đủ data nhưng chưa có tác dụng tới tổng đài.
   */
  maxCallTimeSeconds?: number | null;
  batchSize: number;
  batchIntervalSeconds: number;
  variablePriority?: VariablePriority;
  dedupeConfig?: DedupeConfig;
  runtimeSessionId?: string | null;
  counters?: SessionCounters;
  pausedCause?: string | null;
  cancelCause?: string | null;
  createdTimeMs: number;
  submittedTimeMs?: number | null;
  completedTimeMs?: number | null;
  /**
   * [GAP với BE — chờ sign-off docs 04 §5] Template UI cho kéo-thả thứ tự ưu tiên biến theo 3 NGUỒN
   * (EXCEL / CRM / MANUAL) nhưng contract BE hiện là enum 2 giá trị variablePriority.
   * FE lưu thứ tự đầy đủ ở đây; variablePriority được derive (CRM đứng đầu → CRM_CONTACT_FIRST).
   */
  variableOrder?: string[];
}

export interface DataRow {
  rowId: string;
  clientSessionId: string;
  phoneNumber: string;
  variables?: Record<string, string>;
  source: ClientDataSource;
  rowStatus: ClientRowStatus;
  invalidReason?: string | null;
  priority: number;
  recordId?: string | null;
  /** Chỉ có ở mock/viewer: kết quả cuối của record (join phía BE) */
  callResult?: 'ANSWERED' | 'NO_ANSWER' | 'FAILED' | 'CANCELED' | null;
  createdTimeMs: number;
}

// ===== Requests (mirror 05 §1.1) =====

export interface CreateSessionRequest {
  name: string;
  variableOrder?: string[];
  purpose?: string;
  startTimeMs?: number | null;
  timeSlots?: TimeSlot[];
  timezoneId?: string;
  sipNumbers: SipNumber[];
  scriptUuid?: string;
  voiceOverride?: string | null;
  retryConfig?: RetryConfig | null;
  /** [FR-008] 5–60 giây; không gửi = mặc định tổng đài. */
  ringTimeoutSeconds?: number | null;
  /** [XFuture] 30–3600 giây tính từ lúc kết nối; không gửi = không giới hạn. */
  maxCallTimeSeconds?: number | null;
  batchSize?: number;
  batchIntervalSeconds?: number;
  variablePriority?: VariablePriority;
  dedupeConfig?: DedupeConfig;
}

export interface ManualRowsRequest {
  rows: Array<{ phoneNumber: string; variables?: Record<string, string> }>;
  appendMode?: AppendMode; // chỉ có nghĩa khi phiên RUNNING/PAUSED
  /** Nguồn của đợt nạp — BFF mặc định MANUAL; drawer Excel/CRM truyền tương ứng */
  source?: ClientDataSource;
}

/** PATCH config draft (docs 01 §5: nhóm core chỉ sửa được ở DRAFT). */
export type UpdateSessionRequest = Partial<Omit<CreateSessionRequest, 'sipNumbers'>> & {
  sipNumbers?: SipNumber[];
  variableOrder?: string[];
};

/** Gợi ý contact CRM cho autocomplete drawer Thủ công (mock — real mode sẽ qua API contact). */
export interface ContactSuggestion {
  id: string;
  name: string;
  phones: string[];
}

/** Kết quả import Excel (mock: BFF parse tại chỗ; real: BE trả sau khi job nền chạy xong). */
export interface ImportExcelResult {
  fileName: string;
  totalRows: number;
  inserted: number;
  duplicated: number;
  invalid: number;
  errors: Array<{ row: number; reason: string }>;
  /** Real mode: job chạy nền → theo dõi qua importBatchId, kết quả chưa có ngay. */
  importBatchId?: string;
  pending?: boolean;
}

export type ImportBatchType = 'IMPORT' | 'RECHECK' | 'EXPORT';
export type ImportStatus = 'RECEIVED' | 'PROCESSING' | 'DONE' | 'FAILED';

/** 1 đợt xử lý nền của phiên (nạp data / tính lại trùng / export) — docs 05 #19. */
export interface ImportBatch {
  id: string;
  clientSessionId: string;
  type?: ImportBatchType;
  source?: ClientDataSource;
  status: ImportStatus;
  totalRows?: number;
  processedRows?: number;
  inserted?: number;
  duplicated?: number;
  invalid?: number;
  /** Excel: file .xlsx chứa dòng lỗi/trùng + cột lý do. */
  errorFileKey?: string | null;
  /** Export: file kết quả. */
  fileKey?: string | null;
  fileName?: string | null;
  failReason?: string | null;
  createdTimeMs?: number;
  finishedTimeMs?: number | null;
}

/** Filter danh bạ CRM khi nạp data nguồn CRM (B6). */
export interface CrmContactFilter {
  tagIds?: string[];
  categoryIds?: string[];
  businessIds?: string[];
  userOwnerIds?: string[];
  createdFromMs?: number;
  createdToMs?: number;
}

/** Báo cáo 1 phiên (B9). */
export interface SessionReport {
  sessionId: string;
  name?: string;
  status?: ClientSessionStatus;
  byRowStatus: Record<string, number>;
  bySource: Record<string, number>;
  byCallResult: Record<string, number>;
  totalRows: number;
  finishedCalls: number;
  /** % nghe máy, đã làm tròn 2 chữ số ở BE. */
  answerRate: number;
  counters?: SessionCounters;
}

// ===== Kịch bản callbot =====

/**
 * 1 kịch bản (bản mới nhất) — từ POST /call-bot/filter/script/newest-version/list.
 * LƯU Ý: khi tạo phiên phải gửi `uuid` (ổn định qua các version), KHÔNG gửi `id`.
 */
export interface CallbotScript {
  id: string;
  uuid: string;
  name: string;
  version?: number;
  isNewestVersion?: boolean;
  /** Biến kịch bản đòi hỏi — nguồn để dựng cột file Excel nạp data. */
  variables?: ScriptVariable[];
}

export interface ScriptVariable {
  fieldCode: string;
  fieldName?: string;
  type?: string;
}

// ===== Lịch sử cuộc gọi (per-record) =====

export type RecordStatus = 'PROCESSING' | 'ANSWERED' | 'NO_ANSWER' | 'FAILED' | 'CANCELED';

/** 1 cuộc gọi đã phát sinh — POST /call-bot/record/search. */
export interface CallRecord {
  recordId: string;
  sessionId?: string;
  phoneNumber: string;
  sipNumber?: string | null;
  status: RecordStatus;
  /** Thời lượng đàm thoại (giây). */
  duration?: number | null;
  /** Lần gọi thứ mấy — >1 là do retry. */
  callIndex?: number | null;
  callIndexTimeMs?: number | null;
  /** Mã + diễn giải lỗi khi status = FAILED. */
  errorCode?: string | null;
  errorMessage?: string | null;
  recordingUrl?: string | null;
  variables?: Record<string, string>;
  startTimeMs?: number | null;
  endTimeMs?: number | null;
}

export interface CallRecordFilter {
  statuses?: RecordStatus[];
  sipNumbers?: string[];
  keyword?: string;
  page?: number;
  size?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

// ===== Clone phiên =====

/**
 * 4 kiểu nhân bản — bám đúng cloneTypes của AutoCall (web-v2 MarketingData.cloneTypes):
 * chỉ cấu hình / toàn bộ KH / KH gọi thất bại / theo trạng thái cuộc gọi.
 */
export type CloneMode = 'CONFIG_ONLY' | 'ALL_CUSTOMERS' | 'FAILED_ONLY' | 'BY_CALL_STATUS';

export interface CloneSessionRequest {
  sourceSessionId: string;
  copyConfig: boolean;
  /** Lọc data mang sang; rỗng = không mang data nào. */
  dataFilter?: { callStatuses?: string[] } | null;
  overrides?: Partial<CreateSessionRequest> | null;
  name?: string;
}

export interface CloneSessionResult {
  session: ClientSession;
  /** Job nền copy data — theo dõi qua /import-batch/search. */
  importBatchId?: string | null;
}

// ===== Envelope (BE dùng {code,message,data} — BFF giữ nguyên) =====

export interface ApiEnvelope<T> {
  code: number;      // 200 = OK; khác = lỗi nghiệp vụ (message + errorCode)
  message: string;
  errorCode?: string; // CS_* khi lỗi nghiệp vụ
  data: T;
}
