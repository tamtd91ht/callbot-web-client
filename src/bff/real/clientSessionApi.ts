/**
 * Transport + mapper cho API MỚI /call-bot/client-session/* (ticket B8 — 12 endpoints,
 * branch feature/client-session-foundation của callbot-service).
 * Envelope + auth y hệt API cũ (VertxController): {status_code: 9999, payload}, Bearer JWT.
 * Lỗi nghiệp vụ nhận diện qua message prefix "CS_XXX: ..." — callOld đã parse thành GatewayError.
 * Body mirror docs 05 + contracts/types.ts (camelCase, id trong body, toàn POST).
 */
import { GatewayError } from '../gateway';
import { baseUrl, callOld, resolveJwt } from './oldApi';
import type {
  ClientDataSource, ClientRowStatus, ClientSession, ClientSessionStatus,
  ContactSuggestion, CreateSessionRequest, DataRow, DedupeConfig, ImportBatch, RetryConfig,
  SessionCounters, SipNumber, TimeSlot, UpdateSessionRequest, VariablePriority,
} from '@/contracts/types';

export function csCall<T>(path: string, body: unknown): Promise<T> {
  return callOld<T>(`/client-session${path}`, body);
}

/* ===================== Shapes backend (mirror ClientSession.java) ===================== */

export interface BeClientSession {
  id: string; // hex — alias getIdHex()
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
  batchSize?: number;
  batchIntervalSeconds?: number;
  variablePriority?: VariablePriority;
  variableOrder?: string[];
  dedupeConfig?: DedupeConfig;
  runtimeSessionId?: string | null;
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

export interface BeIngestResult {
  inserted?: number;
  duplicated?: number;
  invalid?: number;
  rowOutcomes?: Array<{ rowId: string; phoneNumber?: string; status?: ClientRowStatus; reason?: string }>;
}

export interface BeDataPage {
  rows?: BeDataRow[];
  total?: number;
  nextSearchAfter?: unknown[];
}

/* ===================== Mapping backend → contracts ===================== */

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
    batchSize: dto.batchSize ?? 50,
    batchIntervalSeconds: dto.batchIntervalSeconds ?? 30,
    variablePriority: dto.variablePriority,
    variableOrder: dto.variableOrder,
    dedupeConfig: dto.dedupeConfig,
    runtimeSessionId: dto.runtimeSessionId ?? null,
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
    callResult: null, // join kết quả gọi qua recordId: B9 viewer — chưa có ở B8
    createdTimeMs: dto.createdTimeMs ?? 0,
  };
}

/**
 * Làm sạch config trước khi gửi BE:
 *  - voiceOverride '' (option "Theo kịch bản") → bỏ hẳn — BE là enum Voice, Jackson gặp '' sẽ
 *    fail parse và applyJsonConfig bỏ qua TOÀN BỘ config phức (mất sipNumbers).
 *  - loại mọi key undefined/null để không đè giá trị đang có khi update.
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

export const mapContactSuggestion = (raw: { id?: string; name?: string; phones?: string[] }): ContactSuggestion => ({
  id: raw.id ?? '',
  name: raw.name ?? 'Không xác định',
  phones: raw.phones ?? [],
});

/* ===================== Job nền (import/recheck/export) ===================== */

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

/** Upload multipart — endpoint duy nhất không phải JSON, nên không đi qua callOld. */
export async function csUpload<T>(path: string, form: FormData): Promise<T> {
  // Dùng CHUNG cách lấy token với callOld: ưu tiên token user dán ở UI, fallback env
  const jwt = await resolveJwt();
  if (!jwt) {
    throw new GatewayError('CS_UNAUTHORIZED',
      'Chưa có token — bấm nút "Token" trên thanh header để dán JWT');
  }
  const res = await fetch(`${baseUrl()}/client-session${path}`, {
    method: 'POST',
    headers: { Authorization: jwt.startsWith('Bearer ') ? jwt : `Bearer ${jwt}` }, // KHÔNG set Content-Type: fetch tự thêm boundary
    body: form,
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) {
    throw new GatewayError('CS_UNAUTHORIZED', 'JWT hết hạn hoặc không hợp lệ');
  }
  const text = await res.text();
  let envelope: { status_code?: number; statusCode?: number; message?: string; payload?: T };
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new GatewayError('CS_BAD_GATEWAY', `Response không phải JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if ((envelope.status_code ?? envelope.statusCode) !== 9999) {
    const msg = envelope.message || 'Upload thất bại';
    const prefixed = /^(CS_[A-Z_]+):\s*(.*)$/s.exec(msg);
    throw prefixed ? new GatewayError(prefixed[1], prefixed[2] || msg) : new GatewayError('CS_UPSTREAM_ERROR', msg);
  }
  return envelope.payload as T;
}
