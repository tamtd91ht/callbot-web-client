/**
 * Mapper BE → contracts FE. THUẦN, không import gì của server (`next/headers`, fs…)
 * vì dùng ở CẢ hai phía: browser gọi thẳng stg (real mode) và BFF mock.
 *
 * Envelope BE: {status_code: 9999 | -9999, message?, payload}. Lỗi nghiệp vụ mang prefix
 * "CS_XXX: ..." trong message (BE không có field errorCode riêng — convention B8).
 */
import type {
  CallbotScript, CallRecord, ClientDataSource, ClientRowStatus, ClientSession, ClientSessionStatus,
  ContactSuggestion, CreateSessionRequest, DataRow, DedupeConfig, ImportBatch, RecordStatus,
  RetryConfig, ScriptVariable, SessionCounters, SipNumber, TimeSlot, UpdateSessionRequest,
  VariablePriority,
} from './types';

export const SUCCESS_CODE = 9999;

/* ===================== Shapes BE — luồng client mới ===================== */

export interface BeClientSession {
  id: string;
  tenantId?: string;
  name?: string;
  purpose?: string;
  status?: ClientSessionStatus;
  startTimeMs?: number;
  timeSlots?: TimeSlot[];
  timezoneId?: string;
  sipNumbers?: SipNumber[];
  scriptId?: string;
  scriptUuid?: string;
  voiceOverride?: string | null;
  retryConfig?: RetryConfig | null;
  ringTimeoutSeconds?: number | null;
  maxCallTimeSeconds?: number | null;
  batchSize?: number;
  batchIntervalSeconds?: number;
  variablePriority?: VariablePriority;
  variableOrder?: string[];
  dedupeConfig?: DedupeConfig;
  runtimeSessionId?: string | null;
  runtimeSessionTimeMs?: number | null;
  counters?: Partial<SessionCounters>;
  cancelCause?: string | null;
  pausedCause?: string | null;
  createdTimeMs?: number;
  submittedTimeMs?: number | null;
  completedTimeMs?: number | null;
}

export interface BeDataRow {
  rowId: string;
  clientSessionId?: string;
  phoneNumber?: string;
  variables?: Record<string, string>;
  source?: ClientDataSource;
  rowStatus?: ClientRowStatus;
  invalidReason?: string | null;
  priority?: number;
  recordId?: string | null;
  createdTimeMs?: number;
}

export interface BeDataPage {
  rows?: BeDataRow[];
  total?: number;
  nextSearchAfter?: unknown[];
}

export interface BeIngestResult {
  inserted?: number;
  duplicated?: number;
  invalid?: number;
  rowOutcomes?: Array<{ rowId: string; phoneNumber?: string; status?: ClientRowStatus; reason?: string }>;
}

export interface BeImportBatch {
  id?: string;
  _id?: string;
  clientSessionId?: string;
  type?: ImportBatch['type'];
  source?: ClientDataSource;
  status?: ImportBatch['status'];
  totalRows?: number;
  processedRows?: number;
  inserted?: number;
  duplicated?: number;
  invalid?: number;
  errorFileMinioKey?: string | null;
  file?: { minioKey?: string; name?: string; size?: number } | null;
  failReason?: string | null;
  createdTimeMs?: number;
  finishedTimeMs?: number | null;
}

/* ===================== Shapes BE — luồng CŨ (read-only) ===================== */

export interface OldPaginated<T> {
  total_items?: number;
  totalItems?: number;
  pageNumber?: number;
  pageSize?: number;
  items?: T[];
}

export interface OldSessionDTO {
  id: string;
  name?: string;
  status?: 'PROCESSING' | 'PAUSING' | 'CANCELED' | 'DONE';
  createdTimeMs?: number;
  sessionTimeMs?: number;
  cause?: string;
  voice?: string;
  source?: string;
  scriptId?: string;
  scriptUUID?: string;
  timezoneId?: string;
  timeSlots?: TimeSlot[];
  sipNumberDTOs?: Array<{ number: string; network?: string; gateway?: string; isRoutingNumber?: boolean }>;
  numberRetryCall?: number;
  retryCallAfterSeconds?: number;
  recordData?: { total?: number; totalRetry?: number; canceled?: number; failed?: number; answered?: number; noAnswer?: number };
}

export interface OldRecordDTO {
  recordId?: string;
  id?: string;
  phoneNumber?: string;
  contactName?: string;
  status?: 'PROCESSING' | 'ANSWERED' | 'NO_ANSWER' | 'FAILED' | 'CANCELED';
  source?: string;
  refId?: string;
  createdTimeMs?: number;
  cause?: string;
}

/* ===================== Shapes BE — kịch bản & lịch sử cuộc gọi ===================== */

/** CallBotScriptForFilterDTO — /filter/script/newest-version/list và /list-by-uuids. */
export interface BeScriptDTO {
  id?: string;
  uuid?: string;
  name?: string;
  version?: number;
  isNewestVersion?: boolean;
  /** Một số bản BE trả kèm biến kịch bản; tên field chưa chốt nên nhận cả 2 dạng. */
  variables?: Array<{ fieldCode?: string; fieldName?: string; type?: string }>;
  scriptVariables?: Array<{ fieldCode?: string; fieldName?: string; type?: string }>;
}

/** CallBotRecordDTO — /record/search. BE chưa chốt hết tên field nên map phòng thủ. */
export interface BeRecordDTO {
  recordId?: string;
  id?: string;
  sessionId?: string;
  phoneNumber?: string;
  sipNumber?: string | null;
  status?: RecordStatus;
  duration?: number | null;
  billSec?: number | null;
  callIndex?: number | null;
  callIndexTimeMs?: number | null;
  errorCode?: string | null;
  cause?: string | null;
  errorMessage?: string | null;
  recordingUrl?: string | null;
  recordFile?: string | null;
  variables?: Record<string, string>;
  startTimeMs?: number | null;
  timeStartToAnswer?: number | null;
  endTimeMs?: number | null;
  createdTimeMs?: number | null;
}

/* ===================== Composite id (API cũ cần sessionTimeMs) ===================== */

export function compositeId(sessionId: string, sessionTimeMs: number | undefined): string {
  return `${sessionId}~${sessionTimeMs ?? 0}`;
}

export function parseCompositeId(id: string): { sessionId: string; sessionTimeMs: number } {
  const idx = id.lastIndexOf('~');
  if (idx < 0) return { sessionId: id, sessionTimeMs: 0 };
  return { sessionId: id.slice(0, idx), sessionTimeMs: Number(id.slice(idx + 1)) || 0 };
}

export const isLegacyId = (id: string) => id.includes('~');

/* ===================== Mapping ===================== */

export function mapClientSession(dto: BeClientSession): ClientSession {
  const c = dto.counters ?? {};
  const total = c.total ?? 0;
  const finished = (c.answered ?? 0) + (c.noAnswer ?? 0) + (c.failed ?? 0) + (c.canceled ?? 0);
  const counters: SessionCounters = {
    total,
    staged: c.staged ?? 0,
    duplicated: c.duplicated ?? 0,
    invalid: c.invalid ?? 0,
    queued: c.queued ?? 0,
    dispatched: c.dispatched ?? 0,
    remaining: Math.max(0, total - finished),
    answered: c.answered ?? 0,
    noAnswer: c.noAnswer ?? 0,
    failed: c.failed ?? 0,
    canceled: c.canceled ?? 0,
    totalRecords: c.dispatched ?? 0,
    retried: c.retried ?? 0,
  };
  return {
    id: dto.id,
    tenantId: dto.tenantId ?? '',
    name: dto.name ?? dto.id,
    purpose: dto.purpose,
    status: dto.status ?? 'DRAFT',
    startTimeMs: dto.startTimeMs ?? null,
    timeSlots: dto.timeSlots,
    timezoneId: dto.timezoneId,
    sipNumbers: dto.sipNumbers ?? [],
    scriptId: dto.scriptId,
    scriptUuid: dto.scriptUuid,
    voiceOverride: dto.voiceOverride ?? null,
    retryConfig: dto.retryConfig ?? null,
    ringTimeoutSeconds: dto.ringTimeoutSeconds ?? null,
    maxCallTimeSeconds: dto.maxCallTimeSeconds ?? null,
    batchSize: dto.batchSize ?? 50,
    batchIntervalSeconds: dto.batchIntervalSeconds ?? 30,
    variablePriority: dto.variablePriority,
    variableOrder: dto.variableOrder,
    dedupeConfig: dto.dedupeConfig,
    runtimeSessionId: dto.runtimeSessionId ?? null,
    runtimeSessionTimeMs: dto.runtimeSessionTimeMs ?? null,
    counters,
    pausedCause: dto.pausedCause ?? null,
    cancelCause: dto.cancelCause ?? null,
    createdTimeMs: dto.createdTimeMs ?? 0,
    submittedTimeMs: dto.submittedTimeMs ?? null,
    completedTimeMs: dto.completedTimeMs ?? null,
  };
}

export function mapClientRow(dto: BeDataRow, clientSessionId: string): DataRow {
  return {
    rowId: dto.rowId,
    clientSessionId: dto.clientSessionId ?? clientSessionId,
    phoneNumber: dto.phoneNumber ?? '',
    variables: dto.variables,
    source: dto.source ?? 'MANUAL',
    rowStatus: dto.rowStatus ?? 'STAGED',
    invalidReason: dto.invalidReason ?? null,
    priority: dto.priority ?? 0,
    recordId: dto.recordId ?? null,
    callResult: null, // join kết quả gọi qua recordId là việc của viewer (B9), không có ở đây
    createdTimeMs: dto.createdTimeMs ?? 0,
  };
}

export function mapImportBatch(dto: BeImportBatch): ImportBatch {
  return {
    // MongoEntity serialize `_id`; ClientSession có alias `id` còn ImportBatch thì chưa
    id: dto.id ?? dto._id ?? '',
    clientSessionId: dto.clientSessionId ?? '',
    type: dto.type ?? 'IMPORT',
    source: dto.source,
    status: dto.status ?? 'RECEIVED',
    totalRows: dto.totalRows ?? 0,
    processedRows: dto.processedRows ?? 0,
    inserted: dto.inserted ?? 0,
    duplicated: dto.duplicated ?? 0,
    invalid: dto.invalid ?? 0,
    errorFileKey: dto.errorFileMinioKey ?? null,
    fileKey: dto.file?.minioKey ?? null,
    fileName: dto.file?.name ?? null,
    failReason: dto.failReason ?? null,
    createdTimeMs: dto.createdTimeMs,
    finishedTimeMs: dto.finishedTimeMs ?? null,
  };
}

const OLD_STATUS_MAP: Record<string, ClientSessionStatus> = {
  PROCESSING: 'RUNNING', PAUSING: 'PAUSED', CANCELED: 'CANCELED', DONE: 'COMPLETED',
};

export function mapOldSession(dto: OldSessionDTO): ClientSession {
  const rd = dto.recordData ?? {};
  const total = rd.total ?? 0;
  const finished = (rd.answered ?? 0) + (rd.noAnswer ?? 0) + (rd.failed ?? 0) + (rd.canceled ?? 0);
  return {
    id: compositeId(dto.id, dto.sessionTimeMs),
    tenantId: '', // BE đã scope theo JWT
    name: dto.name ?? dto.id,
    purpose: dto.source ? `Luồng cũ (${dto.source})` : 'Luồng cũ',
    status: OLD_STATUS_MAP[dto.status ?? 'PROCESSING'] ?? 'RUNNING',
    startTimeMs: dto.createdTimeMs ?? null,
    timeSlots: dto.timeSlots,
    timezoneId: dto.timezoneId,
    sipNumbers: (dto.sipNumberDTOs ?? []).map((s) => ({
      number: s.number, network: s.network, gateway: s.gateway, isRoutingNumber: s.isRoutingNumber,
    })),
    scriptId: dto.scriptId,
    scriptUuid: dto.scriptUUID,
    voiceOverride: dto.voice ?? null,
    // Phiên LUỒNG CŨ chỉ có 2 field dẫn xuất; dựng lại dạng mới để UI hiển thị chung một kiểu.
    // Luồng cũ chỉ biết gọi lại khi không nghe máy nên actionCodes luôn đúng một giá trị.
    retryConfig: dto.numberRetryCall && dto.numberRetryCall > 0
      ? {
        trigger: 'CALL_STATUS', actionCodes: ['NO_ANSWER'],
        maxRetry: dto.numberRetryCall, delaySeconds: dto.retryCallAfterSeconds ?? 0,
      }
      : null,
    batchSize: 0,
    batchIntervalSeconds: 0,
    counters: {
      total,
      staged: 0, duplicated: 0, invalid: 0, queued: 0, // khái niệm staging chỉ có ở luồng client mới
      dispatched: total,
      remaining: Math.max(0, total - finished),
      answered: rd.answered ?? 0,
      noAnswer: rd.noAnswer ?? 0,
      failed: rd.failed ?? 0,
      canceled: rd.canceled ?? 0,
      totalRecords: total,
      retried: rd.totalRetry ?? 0,
    },
    cancelCause: dto.status === 'CANCELED' ? dto.cause ?? null : null,
    pausedCause: dto.status === 'PAUSING' ? dto.cause ?? 'Tạm dừng' : null,
    createdTimeMs: dto.createdTimeMs ?? 0,
  };
}

export function mapOldRecord(dto: OldRecordDTO, clientSessionId: string): DataRow {
  const status = dto.status ?? 'PROCESSING';
  return {
    rowId: dto.recordId ?? dto.id ?? `${clientSessionId}_${dto.phoneNumber}`,
    clientSessionId,
    phoneNumber: dto.phoneNumber ?? '',
    variables: dto.contactName ? { full_name: dto.contactName } : undefined,
    source: (dto.source as DataRow['source']) ?? 'THIRD_PARTY',
    rowStatus: status === 'PROCESSING' ? 'DISPATCHED' : 'DONE',
    invalidReason: status === 'FAILED' ? dto.cause ?? null : null,
    priority: dto.createdTimeMs ?? 0,
    recordId: dto.recordId ?? dto.id ?? null,
    callResult: status === 'PROCESSING' ? null : status,
    createdTimeMs: dto.createdTimeMs ?? 0,
  };
}

export function mapScript(dto: BeScriptDTO): CallbotScript {
  const rawVariables = dto.variables ?? dto.scriptVariables ?? [];
  const variables: ScriptVariable[] = rawVariables
    .filter((v) => !!v.fieldCode)
    .map((v) => ({ fieldCode: v.fieldCode!, fieldName: v.fieldName, type: v.type }));
  return {
    id: dto.id ?? '',
    // uuid là thứ gửi lên khi tạo phiên; thiếu uuid thì kịch bản này vô dụng nên fallback về id
    uuid: dto.uuid ?? dto.id ?? '',
    name: dto.name ?? dto.uuid ?? 'Kịch bản không tên',
    version: dto.version,
    isNewestVersion: dto.isNewestVersion,
    variables: variables.length > 0 ? variables : undefined,
  };
}

export function mapCallRecord(dto: BeRecordDTO): CallRecord {
  // timeStartToAnswer của BE tính bằng GIÂY (ghi rõ trong callbot-speed-note), không phải millis
  const startTimeMs = dto.startTimeMs
    ?? (dto.timeStartToAnswer ? dto.timeStartToAnswer * 1000 : null)
    ?? dto.createdTimeMs
    ?? null;
  return {
    recordId: dto.recordId ?? dto.id ?? '',
    sessionId: dto.sessionId,
    phoneNumber: dto.phoneNumber ?? '',
    sipNumber: dto.sipNumber ?? null,
    status: dto.status ?? 'PROCESSING',
    duration: dto.duration ?? dto.billSec ?? null,
    callIndex: dto.callIndex ?? null,
    callIndexTimeMs: dto.callIndexTimeMs ?? null,
    errorCode: dto.errorCode ?? null,
    errorMessage: dto.errorMessage ?? dto.cause ?? null,
    recordingUrl: dto.recordingUrl ?? dto.recordFile ?? null,
    variables: dto.variables,
    startTimeMs,
    endTimeMs: dto.endTimeMs ?? null,
  };
}

export const mapContactSuggestion = (raw: { id?: string; name?: string; phones?: string[] }): ContactSuggestion => ({
  id: raw.id ?? '',
  name: raw.name ?? 'Không xác định',
  phones: raw.phones ?? [],
});

/**
 * Làm sạch config trước khi gửi BE:
 *  - voiceOverride '' (option "Theo kịch bản") → bỏ hẳn: BE là enum Voice, Jackson gặp ''
 *    sẽ fail parse và bỏ qua TOÀN BỘ config phức (mất luôn sipNumbers).
 *  - loại key undefined/null để không đè giá trị đang có khi update.
 */
export function sanitizeConfig<T extends CreateSessionRequest | UpdateSessionRequest>(req: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req)) {
    if (v === undefined || v === null) continue;
    if (k === 'voiceOverride' && v === '') continue;
    out[k] = v;
  }
  return out;
}
