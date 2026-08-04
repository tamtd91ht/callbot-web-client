'use client';
/**
 * Lấy danh mục THẬT (đầu số / kịch bản / giọng đọc) từ 3 gateway của OmiCRM.
 * Nguồn: `callbot-service/docs/related-api/*.txt` (curl do owner cung cấp 2026-08-03).
 *
 *   đầu số     GET  {pbx}/public_number_of_tenant/list_active
 *   kịch bản   GET  {chatbot}/callbot/script/list-by-tenant/{tenantId}   ← tenantId từ claim JWT
 *   giọng đọc  POST {chatbot}/bot-accent/list-all   body {}
 *
 * Gọi TRỰC TIẾP từ trình duyệt (đã verify 2 gateway đều echo `Access-Control-Allow-Origin`
 * theo origin gọi tới, nên không cần proxy). Dùng chung token dán ở UI.
 *
 * ⚠️ Shape response CHƯA được xác nhận bằng tài liệu — nên phần bóc dữ liệu ở đây cố tình
 * "dò nhiều tên field" và luôn trả `raw` để UI hiện ra khi không bóc được, thay vì im lặng
 * đưa danh sách rỗng. Khi chốt được shape thật thì rút gọn {@link pickList}/các `pick*` lại.
 */
import type { SipNumber } from '@/contracts/types';
import { getToken, tokenTenantId } from './token';

export interface ScriptOption { uuid: string; name: string }

const CHATBOT_BASE = (process.env.NEXT_PUBLIC_CHATBOT_GATEWAY_URL
  || 'https://chatbot-gateway-v1-stg.omicrm.com').replace(/\/$/, '');
const PBX_BASE = (process.env.NEXT_PUBLIC_PBX_GATEWAY_URL
  || 'https://pbx-v1-stg.omicrm.com').replace(/\/$/, '');
const QUERY = 'lng=vi&utm_source=web';

export interface CatalogResult<T> {
  items: T[];
  /** Đã gọi được API nhưng không bóc ra được item nào → giữ mẫu thô để hiện lên UI mà chỉnh. */
  unparsed?: string;
}

export class CatalogError extends Error {}

async function call<T>(url: string, init?: RequestInit): Promise<unknown> {
  const token = getToken();
  if (!token) throw new CatalogError('Chưa có token — bấm nút "Token" trên thanh header để dán JWT');
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      ...init?.headers,
    },
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) {
    throw new CatalogError('Token hết hạn hoặc không có quyền đọc danh mục này');
  }
  const text = await res.text();
  if (!res.ok) {
    throw new CatalogError(`Gateway trả HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CatalogError(`Response không phải JSON: ${text.slice(0, 120)}`);
  }
}

/** Tìm mảng dữ liệu trong response — mỗi service của OmiCRM bọc một kiểu khác nhau. */
function pickList(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  for (const key of ['data', 'items', 'result', 'results', 'rows', 'list', 'payload', 'content']) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = pickList(value); // vd {data:{items:[…]}}
      if (nested) return nested;
    }
  }
  return null;
}

const str = (row: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
};

function sample(payload: unknown): string {
  return JSON.stringify(payload).slice(0, 600);
}

/* ============================== Đầu số ============================== */

export async function fetchSipNumbers(): Promise<CatalogResult<SipNumber>> {
  const payload = await call(`${PBX_BASE}/public_number_of_tenant/list_active?${QUERY}`);
  const rows = pickList(payload);
  if (!rows) return { items: [], unparsed: sample(payload) };
  const items = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((row) => ({
      number: str(row, 'number', 'phone_number', 'phoneNumber', 'sip_number', 'sipNumber', 'name'),
      network: str(row, 'network', 'network_name', 'telco', 'provider', 'carrier') || undefined,
      gateway: str(row, 'gateway', 'gateway_name', 'gateway_uuid', 'gatewayName') || undefined,
      isRoutingNumber: Boolean(row.is_routing_number ?? row.isRoutingNumber ?? false),
    }))
    .filter((s) => s.number);
  return items.length ? { items } : { items: [], unparsed: sample(payload) };
}

/* ============================== Kịch bản ============================== */

export async function fetchScripts(): Promise<CatalogResult<ScriptOption>> {
  const tenantId = tokenTenantId(getToken());
  if (!tenantId) {
    throw new CatalogError('Token không có claim tenant_id nên không gọi được API danh sách kịch bản');
  }
  const payload = await call(`${CHATBOT_BASE}/callbot/script/list-by-tenant/${tenantId}?${QUERY}`);
  const rows = pickList(payload);
  if (!rows) return { items: [], unparsed: sample(payload) };
  const items = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((row) => ({
      // BE nhận scriptUuid — ưu tiên field uuid, KHÔNG lấy _id (id bản version, đổi mỗi lần sửa kịch bản)
      uuid: str(row, 'uuid', 'script_uuid', 'scriptUuid', 'scriptUUID'),
      name: str(row, 'name', 'script_name', 'title', 'display_name') || '(không tên)',
    }))
    .filter((s) => s.uuid);
  return items.length ? { items } : { items: [], unparsed: sample(payload) };
}

/* ============================== Giọng đọc ============================== */

export interface VoiceOption { value: string; label: string }

export async function fetchVoices(): Promise<CatalogResult<VoiceOption>> {
  const payload = await call(`${CHATBOT_BASE}/bot-accent/list-all?${QUERY}`, {
    method: 'POST', body: JSON.stringify({}),
  });
  const rows = pickList(payload);
  if (!rows) return { items: [], unparsed: sample(payload) };
  const items = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((row) => {
      // value phải KHỚP enum Voice của BE (vd northern_female_ngocanh) — sai là Jackson
      // fail parse và BE bỏ qua toàn bộ config phức, mất luôn sipNumbers
      const value = str(row, 'code', 'accent', 'accent_code', 'value', 'key', 'voice', 'name');
      const label = str(row, 'display_name', 'displayName', 'label', 'title', 'name') || value;
      return { value, label };
    })
    .filter((v) => v.value);
  return items.length ? { items } : { items: [], unparsed: sample(payload) };
}
