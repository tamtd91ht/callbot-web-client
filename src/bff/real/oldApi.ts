/**
 * Transport + mapper cho API CŨ của callbot-service trên stg (https://callbot-v2-stg.omicrm.com).
 * Xác minh từ source SessionController/VertxController (2026-08-03):
 *  - Envelope: { status_code: 9999 | -9999, statusCode, message?, keyEnabled: false, payload }
 *    HTTP luôn 200 với lỗi nghiệp vụ; sai/thiếu JWT → HTTP 401 body text "Unauthorized".
 *  - Auth: header Authorization: Bearer <JWT> (Vert.x JWTAuthHandler).
 *  - get-by-id/pause/continue/cancel cần {sessionId, sessionTimeMs} → FE dùng composite id `sid~timeMs`.
 */
import { GatewayError } from '../gateway';
import type { ClientSession, ClientSessionStatus, DataRow, SessionCounters } from '@/contracts/types';

const SUCCESS_CODE = 9999;

export function baseUrl(): string {
  return (process.env.CALLBOT_BASE_URL || 'https://callbot-v2-stg.omicrm.com/call-bot').replace(/\/$/, '');
}

export async function callOld<T>(path: string, body: unknown): Promise<T> {
  const jwt = process.env.CALLBOT_JWT || '';
  if (!jwt) {
    throw new GatewayError('CS_UNAUTHORIZED', 'Chưa cấu hình CALLBOT_JWT trong .env — lấy token đăng nhập OmiCRM stg rồi điền vào');
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: jwt.startsWith('Bearer ') ? jwt : `Bearer ${jwt}`,
    },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) {
    throw new GatewayError('CS_UNAUTHORIZED', 'JWT hết hạn hoặc không hợp lệ (401 từ callbot-v2-stg)');
  }
  const text = await res.text();
  let envelope: { status_code?: number; statusCode?: number; message?: string; payload?: T };
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new GatewayError('CS_BAD_GATEWAY', `Response không phải JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  const code = envelope.status_code ?? envelope.statusCode;
  if (code !== SUCCESS_CODE) {
    throw new GatewayError('CS_UPSTREAM_ERROR', envelope.message || `Lỗi backend (code ${code})`);
  }
  return envelope.payload as T;
}

/* ===================== Shapes API cũ (mirror Java DTO) ===================== */

export interface OldPaginated<T> {
  total_items?: number;
  totalItems?: number;
  pageNumber?: number;
  pageSize?: number;
  items?: T[];
}

export interface OldSessionDTO {
  id: string; // sessionId
  name?: string;
  status?: 'PROCESSING' | 'PAUSING' | 'CANCELED' | 'DONE';
  createdTimeMs?: number;
  sessionTimeMs?: number;
  cause?: string;
  voice?: string;
  source?: string; // WEB | API | CAMPAIGN
  scriptId?: string;
  scriptUUID?: string;
  timezoneId?: string;
  timeSlots?: Array<{ from: string; to: string }>;
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

/* ===================== Composite id (old API cần sessionTimeMs) ===================== */

export function compositeId(sessionId: string, sessionTimeMs: number | undefined): string {
  return `${sessionId}~${sessionTimeMs ?? 0}`;
}

export function parseCompositeId(id: string): { sessionId: string; sessionTimeMs: number } {
  const idx = id.lastIndexOf('~');
  if (idx < 0) return { sessionId: id, sessionTimeMs: 0 };
  return { sessionId: id.slice(0, idx), sessionTimeMs: Number(id.slice(idx + 1)) || 0 };
}

/* ===================== Mapping old → contracts mới ===================== */

const STATUS_MAP: Record<string, ClientSessionStatus> = {
  PROCESSING: 'RUNNING', PAUSING: 'PAUSED', CANCELED: 'CANCELED', DONE: 'COMPLETED',
};

export function mapSession(dto: OldSessionDTO): ClientSession {
  const rd = dto.recordData ?? {};
  const total = rd.total ?? 0;
  const finished = (rd.answered ?? 0) + (rd.noAnswer ?? 0) + (rd.failed ?? 0) + (rd.canceled ?? 0);
  const counters: SessionCounters = {
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
  };
  return {
    id: compositeId(dto.id, dto.sessionTimeMs),
    tenantId: '', // BE đã scope theo JWT
    name: dto.name ?? dto.id,
    purpose: dto.source ? `Luồng cũ (${dto.source})` : 'Luồng cũ',
    status: STATUS_MAP[dto.status ?? 'PROCESSING'] ?? 'RUNNING',
    startTimeMs: dto.createdTimeMs ?? null,
    timeSlots: dto.timeSlots,
    timezoneId: dto.timezoneId,
    sipNumbers: (dto.sipNumberDTOs ?? []).map((s) => ({
      number: s.number, network: s.network, gateway: s.gateway, isRoutingNumber: s.isRoutingNumber,
    })),
    scriptId: dto.scriptId,
    scriptUuid: dto.scriptUUID,
    voiceOverride: dto.voice ?? null,
    retryConfig: dto.numberRetryCall && dto.numberRetryCall > 0
      ? { trigger: 'NO_ANSWER', maxRetry: dto.numberRetryCall, delaySeconds: dto.retryCallAfterSeconds ?? 0 }
      : null,
    batchSize: 0,
    batchIntervalSeconds: 0,
    counters,
    cancelCause: dto.status === 'CANCELED' ? dto.cause ?? null : null,
    pausedCause: dto.status === 'PAUSING' ? dto.cause ?? 'Tạm dừng' : null,
    createdTimeMs: dto.createdTimeMs ?? 0,
  };
}

export function mapRecord(dto: OldRecordDTO, clientSessionId: string): DataRow {
  const status = dto.status ?? 'PROCESSING';
  return {
    rowId: dto.recordId ?? dto.id ?? `${clientSessionId}_${dto.phoneNumber}`,
    clientSessionId,
    phoneNumber: dto.phoneNumber ?? '',
    variables: dto.contactName ? { full_name: dto.contactName } : undefined,
    // nguồn của luồng cũ hiển thị nguyên trạng (WEB/API/CAMPAIGN) — SOURCE_LABELS có nhãn riêng
    source: (dto.source as DataRow['source']) ?? 'THIRD_PARTY',
    rowStatus: status === 'PROCESSING' ? 'DISPATCHED' : 'DONE',
    invalidReason: status === 'FAILED' ? dto.cause ?? null : null,
    priority: dto.createdTimeMs ?? 0,
    recordId: dto.recordId ?? dto.id ?? null,
    callResult: status === 'PROCESSING' ? null : status,
    createdTimeMs: dto.createdTimeMs ?? 0,
  };
}
