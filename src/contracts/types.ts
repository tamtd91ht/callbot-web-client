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
export type RetryTrigger = 'CALL_STATUS' | 'CALL_ATTRIBUTE' | 'CONTACT_ATTRIBUTE' | 'CONTACT_STATUS';
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

/** [2026-08-21] Một điều kiện kích hoạt gọi lại: trigger + các mã ứng với trigger đó. */
export interface RetryCondition {
  trigger: RetryTrigger;
  actionCodes?: string[];
}

export interface RetryConfig {
  /**
   * [2026-08-21] Dạng MỚI — NHIỀU điều kiện, ngữ nghĩa HOẶC: một điều kiện khớp là gọi lại.
   * FE luôn tạo dạng này. Không trùng trigger giữa các điều kiện; không gửi cùng cặp cũ bên dưới.
   */
  conditions?: RetryCondition[];
  /** @deprecated dạng CŨ 1 điều kiện — chỉ còn đọc từ session đã lưu trước 2026-08-21 / map luồng cũ. */
  trigger?: RetryTrigger;
  /** @deprecated đi cùng `trigger` dạng cũ. */
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
  /** Dòng đã kết thúc vòng đời hàng đợi (rowStatus DONE) — KHÁC `answered` (kết quả gọi). */
  done: number;
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
  /**
   * Mốc thời gian của PHIÊN RUNTIME (engine cũ) — thứ DUY NHẤT dùng để tính tên index ES của
   * session/record/báo cáo KH.
   *
   * ⚠️ KHÁC `createdTimeMs`/`startTimeMs` của ClientSession (Mongo): hai cái đó là mốc của bản ghi
   * cấu hình phiên, còn cái này sinh ra lúc SUBMIT chạy. Neo cửa sổ báo cáo bằng mốc Mongo thì
   * phiên tạo cuối tháng 12 mà chạy sang tháng 1 sẽ tra sai index → TRẢ RỖNG, không lỗi, không log.
   * null = phiên chưa từng submit nên chưa có dòng báo cáo nào.
   */
  runtimeSessionTimeMs?: number | null;
  counters?: SessionCounters;
  pausedCause?: string | null;
  /** Mốc tự chạy lại (epoch ms) khi tạm dừng CÓ hẹn giờ; null = dừng tới khi bấm Tiếp tục (mặc định). */
  pauseUntilTimeMs?: number | null;
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
  /** Đợt nạp đã sinh ra dòng này — nền của tiến độ gọi theo đợt (FR-006). */
  importBatchId?: string | null;
  rowStatus: ClientRowStatus;
  invalidReason?: string | null;
  priority: number;
  recordId?: string | null;
  /** Chỉ có ở mock/viewer: kết quả cuối của record (join phía BE) */
  callResult?: 'ANSWERED' | 'NO_ANSWER' | 'FAILED' | 'CANCELED' | null;
  createdTimeMs: number;
}

/**
 * Một trang data của phiên (BE: ClientDataPage).
 *
 * Phân trang bằng CURSOR (`search_after`), không phải page number: một phiên có thể vài trăm nghìn
 * dòng, mà ES chặn from/size sâu ở `index.max_result_window` (mặc định 10.000) — dùng page number
 * sẽ hỏng đúng lúc dữ liệu nhiều. Vì vậy chỉ đi tiến/lùi tuần tự, KHÔNG nhảy tới trang bất kỳ.
 */
export interface DataRowPage {
  rows: DataRow[];
  /** Tổng số dòng khớp filter (BE trackTotalHits) — dùng cho "đang xem x/y". */
  total: number;
  /** Cursor cho trang kế; null/rỗng = hết dữ liệu. */
  nextSearchAfter?: unknown[] | null;
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
  /**
   * Tiến độ GỌI của đợt — chỉ có khi hỏi kèm `withCallProgress`, và chỉ với đợt type IMPORT.
   *
   * ⚠️ Đừng nhầm với `processedRows/inserted`: những field đó là tiến độ NẠP (ghi dòng vào hàng
   * đợi), xong từ lâu trước khi cuộc gọi đầu tiên diễn ra. Người dùng hỏi "đợt này xong chưa" là
   * hỏi tiến độ GỌI — chính là field này.
   */
  callProgress?: BatchCallProgress | null;
}

/** Tiến độ GỌI của một đợt nạp (BE: BatchCallProgress). */
export interface BatchCallProgress {
  importBatchId?: string;
  /** Tổng dòng còn sống của đợt (không tính dòng đã xoá). */
  total: number;
  /** Chưa gọi. */
  waiting: number;
  /** Đang trong pipeline gọi. */
  calling: number;
  done: number;
  duplicated: number;
  invalid: number;
  removed: number;
  /** Hết chờ gọi VÀ hết đang gọi. Đợt rỗng KHÔNG phải "xong". */
  completed: boolean;
  percent: number;
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

// ===== Báo cáo khách hàng (A-05) — index gom, MỘT KH = MỘT DÒNG trong MỘT phiên =====

/**
 * ⚠️ TỈ LỆ NGHE MÁY Ở ĐÂY KHÁC `SessionReport`, VÀ CẢ HAI ĐỀU ĐÚNG.
 * Báo cáo này mẫu số là KHÁCH (mỗi KH 1 dòng, lấy `bestStatus` = kết quả TỐT NHẤT của mọi lần
 * gọi); `SessionReport` mẫu số là CUỘC. Khách gọi 3 lần, lần cuối mới nghe máy: ở đây tính
 * 1 khách / 1 nghe máy, báo cáo phiên tính 3 cuộc / 1 nghe máy.
 * BE dặn phải ghi nhãn rõ trên UI, nếu không người dùng sẽ báo lỗi số liệu.
 */
export interface CustomerReportRow {
  phoneNumber: string;
  /** Rỗng = số chưa khớp danh bạ CRM (lọc được qua `hasContact`). */
  contactId?: string | null;
  contactName?: string | null;
  sessionId: string;
  sessionTimeMs: number;
  /** TỔNG record, gồm cả FAILED chưa từng quay số. Để đối chiếu, KHÔNG dùng làm mẫu số. */
  totalRecord?: number | null;
  /** Số lần THỰC SỰ quay số = totalRecord - totalFailedPreDial. Đây mới là mẫu số. */
  totalCall?: number | null;
  /** FAILED trước khi qua wrapper (trùng SĐT, DNC, hết số dư) — chưa từng quay số. */
  totalFailedPreDial?: number | null;
  totalAnswered?: number | null;
  totalNoAnswer?: number | null;
  totalFailed?: number | null;
  totalCanceled?: number | null;
  /** Kết quả TỐT NHẤT trong mọi lần gọi. */
  bestStatus?: string | null;
  /** Trạng thái của lần gọi CUỐI theo thời gian. */
  lastStatus?: string | null;
  totalBillSec?: number | null;
  totalAnswerSec?: number | null;
  /**
   * TB thời gian đổ chuông (ms). BE đã chia sẵn cho `countRingingTime` (số cuộc ĐO ĐƯỢC),
   * KHÔNG phải `totalCall` — nhiều cuộc thiếu mốc trong `call_stacks`.
   * null = chưa đo được cuộc nào; 0 = nghe máy tức thì. Hai thứ khác hẳn nhau.
   */
  avgRingingTimeMs?: number | null;
  /** TB thời gian đàm thoại (ms). LUÔN NHỎ HƠN totalBillSec và đó là đúng — xem `CustomerReportAttempt`. */
  avgTalkTimeMs?: number | null;
  firstCallTimeMs?: number | null;
  lastCallTimeMs?: number | null;
  /** BE tính sẵn = totalCall - 1 (không âm) để mọi client hiển thị giống nhau. */
  retriedCalls?: number | null;
}

/**
 * Ô tổng hợp của màn báo cáo KH — `POST /report/customer/summary`.
 * Dùng ĐÚNG bộ lọc của `/report/customer/list` nên số trên ô luôn khớp danh sách bên dưới.
 */
export interface CustomerReportSummary {
  totalCustomers: number;
  totalRecord: number;
  totalCall: number;
  totalAnswered: number;
  totalNoAnswer: number;
  totalFailed: number;
  totalBillSec: number;
  /** = totalBillSec / totalCall (mọi cuộc đã quay số). */
  avgBillSec?: number | null;
  totalAnswerSec: number;
  /** = totalAnswerSec / totalAnswered — CHỈ cuộc nghe máy. Chia totalCall ra số thấp giả tạo. */
  avgAnswerSec?: number | null;
  avgRingingTimeMs?: number | null;
  avgTalkTimeMs?: number | null;
  byBestStatus: Record<string, number>;
  answeredCustomers: number;
  /**
   * ⚠️ Mẫu số là số KHÁCH, khác `SessionReport.answerRate` vốn mẫu số là số CUỘC.
   * Khách gọi 3 lần, lần cuối mới nghe: ô này 1/1, báo cáo phiên 1/3. Hai số lệch nhau là ĐÚNG.
   */
  answerRateByCustomer: number;
  /** Hai chỉ tiêu TAT theo ngưỡng `tatDays`. Vắng mặt nếu BE chưa có tính năng / agg lỗi. */
  tat?: CustomerReportTatSummary | null;
}

/** Một ô TAT: pass/fail theo ngưỡng, kèm số khách KHÔNG đo được. */
export interface CustomerReportTatBucket {
  /** Đạt ngưỡng (TAT < ngưỡng). */
  pass: number;
  /**
   * Không đạt — GỒM CẢ khách chưa bao giờ nghe máy (với Connect TAT).
   * BE tính bằng `measured - pass` chứ không phải đếm TAT >= ngưỡng, vì khách chưa nghe máy
   * không có giá trị TAT nào để so sánh.
   */
  fail: number;
  /** Số khách ĐO ĐƯỢC = mẫu số của `passRate`. `pass + fail`. */
  measured: number;
  /**
   * Khách KHÔNG đo được: không khớp danh bạ CRM (số lạ), hoặc dòng gom có trước khi BE có
   * tính năng TAT. ⚠️ KHÔNG phải fail — phải hiển thị riêng, nếu không người đọc sẽ tưởng
   * mẫu số là toàn bộ khách.
   */
  unmeasured: number;
  /** `pass / measured × 100`. **null = chưa đo được khách nào**, khác hẳn 0%. */
  passRate: number | null;
}

export interface CustomerReportTatSummary {
  /** Ngưỡng BE đã dùng (đã kẹp về [1, 365]) — có thể khác số người dùng gõ. */
  thresholdDays: number;
  thresholdMs: number;
  totalCustomers: number;
  /** Từ lúc khách vào CRM đến cuộc gọi TRẢ LỜI đầu tiên trong phiên. */
  connect: CustomerReportTatBucket;
  /**
   * Từ lúc khách vào CRM đến cuộc gọi đầu tiên trong phiên (bất kể trả lời).
   * ⚠️ Không suy ra được từ cột `firstCallTimeMs`: cột đó tính cả record FAILED chưa từng quay số,
   * còn chỉ tiêu này chỉ tính cuộc thực sự quay số. Hai số lệch nhau là ĐÚNG.
   */
  firstCall: CustomerReportTatBucket;
}

/** Một lần gọi trong `CustomerReportDetail.attempts`. */
export interface CustomerReportAttempt {
  recordId?: string | null;
  status?: string | null;
  callTimeMs?: number | null;
  cause?: string | null;
  /** Lần gọi lại thứ mấy; null/0 = lần gọi đầu. */
  retryCount?: number | null;
  /** true = FAILED trước khi qua wrapper, chưa từng quay số. */
  isFailedPreDial?: boolean | null;
  /** Từ CDR; null = chưa tra được / chưa ra tổng đài (KHÔNG phải 0 giây). */
  billSec?: number | null;
  answerSec?: number | null;
  /**
   * Đổ chuông (ms) = min(answer_at) - min(ringing_at) trên TOÀN BỘ call_stacks.
   * null = thiếu mốc, không đo được; 0 = nghe máy tức thì.
   * Là chỉ số của TOÀN LUỒNG (hai mốc có thể đến từ hai stack khác nhau), không riêng chặng callbot.
   */
  ringingTimeMs?: number | null;
  /**
   * Đàm thoại (ms) = time_end_call - min(answer_at).
   * ⚠️ LUÔN NHỎ HƠN `billSec` và đó là ĐÚNG: min(answer_at) là lúc chặng ĐẦU TIÊN nhấc máy
   * (thường internal_group), còn billSec tính từ lúc KHÁCH nhấc. Đo thật: talk 15,17s ↔ bill 20s.
   * Đừng "sửa" cho khớp — hai đại lượng đo hai thứ khác nhau.
   */
  talkTimeMs?: number | null;
}

/** Chi tiết 1 KH — chỉ API detail mới trả `attempts` (list bỏ đi cho nhẹ response). */
export interface CustomerReportDetail extends CustomerReportRow {
  refId?: string | null;
  rootRecordIds?: string[] | null;
  lastCause?: string | null;
  attempts?: CustomerReportAttempt[] | null;
  birthdayString?: string | null;
  gender?: string | null;
  customerStatus?: string[] | null;
  buildCount?: number | null;
}

/** Field BE cho phép sort — ngoài whitelist này BE lặng lẽ rơi về `lastCallTimeMs`. */
export type CustomerReportSortField =
  | 'lastCallTimeMs' | 'firstCallTimeMs' | 'totalCall' | 'totalRecord'
  | 'totalAnswered' | 'totalBillSec' | 'totalAnswerSec';

export interface CustomerReportQuery {
  /**
   * BẮT BUỘC — phiên cần xem (runtimeSessionId với phiên luồng mới). Báo cáo này CHỈ dùng cho
   * MỘT phiên, nên BE luôn đặt được routing = sessionId.
   */
  sessionId: string;
  /**
   * BẮT BUỘC — mốc của PHIÊN. BE suy tên index ES từ chính giá trị này, nên sai mốc là tra sai
   * index và trả rỗng. Client luôn biết vì màn báo cáo nằm trong phiên.
   */
  sessionTimeMs: number;
  /**
   * Lọc THỜI ĐIỂM GỌI (tuỳ chọn) — trên `lastCallTimeMs`. KHÔNG liên quan việc chọn index.
   * ⚠️ Khách gọi nhiều lần chỉ có 1 dòng: lọc theo lần gọi CUỐI, nên khách gọi lần đầu ngoài
   * khoảng mà gọi lại trong khoảng thì vẫn hiện.
   */
  fromMs?: number;
  toMs?: number;
  bestStatuses?: string[];
  /** true = chỉ KH đã khớp danh bạ · false = chỉ số lạ · undefined = tất cả. */
  hasContact?: boolean;
  keyword?: string;
  minCalls?: number;
  size?: number;
  /**
   * Số trang — CHỈ để BE dựng nhãn phân trang (`page_number`/`has_next`/`total_pages`).
   * KHÔNG nhảy trang bằng field này: gửi `page` mà thiếu `cursor` thì vẫn ra trang đầu.
   */
  page?: number;
  /** search_after của trang trước; BE trần 200/trang, không dùng from/size sâu. */
  cursor?: string[];
  sortField?: CustomerReportSortField;
  sortAsc?: boolean;
  /**
   * Ngưỡng TAT tính bằng NGÀY LỊCH — mặc định BE dùng 3, kẹp về [1, 365].
   * Chỉ `/report/customer/summary` đọc field này; `/list` bỏ qua.
   */
  tatDays?: number;
}

/**
 * Response THÔ của `/report/customer/list` — khuôn phân trang chuẩn của hệ (`Paginated` trong
 * share lib) nên field là **snake_case**, khác phần còn lại của luồng client session.
 *
 * Đừng dùng type này trong UI: `sessionApi.customerReport()` đã quy về `CustomerReportPage`
 * (camelCase). Để ở đây để chỗ map dữ liệu có type thật thay vì `any`.
 */
export interface CustomerReportPageRaw {
  items?: CustomerReportRow[];
  total_items?: number;
  page_number?: number;
  page_size?: number;
  total_pages?: number;
  has_next?: boolean;
  has_previous?: boolean;
  next_page?: number;
  previous_page?: number;
  max_size?: number;
  /** Ngoài khuôn Paginated — thứ duy nhất đi sâu quá 10.000 doc được. */
  nextCursor?: string[] | null;
}

export interface CustomerReportPage {
  data: CustomerReportRow[];
  total: number;
  /** null = hết trang. Dựa vào đây để dừng, ĐỪNG đoán bằng độ dài mảng. */
  nextCursor: string[] | null;
  size: number;
  /** Nhãn hiển thị. Nhảy trang vẫn phải bằng `nextCursor`, không bằng số này. */
  pageNumber: number;
  totalPages: number;
  /** Tín hiệu dừng chuẩn — BE tính theo còn cursor hay không, không theo phép chia total/size. */
  hasNext: boolean;
  hasPrevious: boolean;
}

// ===== Phiên LUỒNG CŨ (CallBotHandler) — /session/search + /session/report =====

/** Trạng thái gốc của phiên luồng cũ. KHÁC `ClientSessionStatus` của luồng mới. */
export type LegacySessionStatus = 'PROCESSING' | 'PAUSING' | 'CANCELED' | 'DONE';

/**
 * Bộ lọc phiên luồng cũ (`CallBotSessionFilter`). Khác `/client-session/search` ở chỗ
 * BE **thật sự đọc** các filter này, nên lọc chạy phía SERVER.
 */
export interface LegacySessionFilter {
  /**
   * BẮT BUỘC cả hai. `CallBotFilter.validate()` ném `"invalid time range"` (chuỗi trần,
   * KHÔNG có prefix CS_) khi thiếu, và so sánh là `fromDate >= toDate` → **bằng nhau cũng lỗi**.
   * ⚠️ `toDate` tương lai bị kẹp về `now` TRƯỚC khi so sánh.
   */
  fromDate: number;
  toDate: number;
  status?: LegacySessionStatus[];
  /** ⚠️ BE chỉ áp dụng khi độ dài > 3 ký tự — ngắn hơn thì BỎ QUA IM LẶNG, trả về mọi phiên. */
  keyword?: string;
  scriptUUIDs?: string[];
  sipNumbers?: string[];
  page?: number;
  size?: number;
}

/**
 * Tổng hợp báo cáo phiên luồng cũ (`POST /session/report` → `CallBotSessionReportData`).
 * Mẫu số là **CUỘC GỌI** (record), không phải khách — khác `CustomerReportSummary`.
 * Không có phần thời lượng: service luồng cũ chỉ đếm theo trạng thái record.
 */
export interface LegacySessionReport {
  totalSession: number;
  totalRecord: number;
  totalAnswered: number;
  totalNoAnswer: number;
  totalFailed: number;
  totalCanceled: number;
  totalProcessing: number;
}

// ===== Envelope (BE dùng {code,message,data} — BFF giữ nguyên) =====

export interface ApiEnvelope<T> {
  code: number;      // 200 = OK; khác = lỗi nghiệp vụ (message + errorCode)
  message: string;
  errorCode?: string; // CS_* khi lỗi nghiệp vụ
  data: T;
}
