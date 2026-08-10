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

export interface ScriptOption {
  uuid: string;
  name: string;
  /**
   * Biến kịch bản đòi hỏi. CallBot chỉ chọn 1 kịch bản (khác AutoCall chọn nhiều thành phần)
   * nên ta dùng chỗ trống đó hiển thị luôn các biến cần nạp — người dùng biết trước file Excel
   * phải có cột nào, thay vì import xong mới thấy hàng loạt dòng INVALID.
   */
  variables?: Array<{ fieldCode: string; fieldName?: string }>;
}

const CHATBOT_BASE = (process.env.NEXT_PUBLIC_CHATBOT_GATEWAY_URL
  || 'https://chatbot-gateway-v1-stg.omicrm.com').replace(/\/$/, '');
const PBX_BASE = (process.env.NEXT_PUBLIC_PBX_GATEWAY_URL
  || 'https://pbx-v1-stg.omicrm.com').replace(/\/$/, '');
/** Mục đích cuộc gọi nằm ở service CDR (danh mục tenant tự định nghĩa). */
const CDR_BASE = (process.env.NEXT_PUBLIC_CDR_GATEWAY_URL
  || 'https://cdr-v1-stg.omicrm.com').replace(/\/$/, '');
/** Thẻ / nhóm KH / loại hình nằm ở tenant-config. */
const TENANT_CONFIG_BASE = (process.env.NEXT_PUBLIC_TENANT_CONFIG_URL
  || 'https://tenant-config-stg.omicrm.com').replace(/\/$/, '');
/** Prefix mã quốc gia nằm ở service tenant. */
const TENANT_BASE = (process.env.NEXT_PUBLIC_TENANT_GATEWAY_URL
  || 'https://tenant-v1-stg.omicrm.com').replace(/\/$/, '');
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

/**
 * Số này có được phép gọi RA không? PBX trả cả số chỉ nhận cuộc vào.
 * Cờ nằm trong `configs.allow_call_out`; nếu response không có `configs` thì coi như được phép
 * (thà cho chọn rồi BE chặn, hơn là lọc sạch danh sách vì shape khác dự kiến).
 */
function allowsCallOut(row: Record<string, unknown>): boolean {
  const configs = row.configs ?? row.config;
  if (!configs || typeof configs !== 'object') return true;
  const flag = (configs as Record<string, unknown>).allow_call_out
    ?? (configs as Record<string, unknown>).allowCallOut;
  return flag === undefined ? true : flag === true;
}

/* ============================== Đầu số ============================== */

export async function fetchSipNumbers(): Promise<CatalogResult<SipNumber>> {
  const payload = await call(`${PBX_BASE}/public_number_of_tenant/list_active?${QUERY}`);
  const rows = pickList(payload);
  if (!rows) return { items: [], unparsed: sample(payload) };
  const items = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    // Chỉ giữ số ĐƯỢC PHÉP GỌI RA — app OMICRM thật cũng lọc vậy (parseSipNumber với
    // isValidateCallOutConfig). Không lọc thì người dùng chọn được số chỉ nhận cuộc vào,
    // phiên submit xong mới chết ở tổng đài.
    .filter((row) => allowsCallOut(row))
    .map((row) => ({
      number: str(row, 'number', 'phone_number', 'phoneNumber', 'sip_number', 'sipNumber', 'name'),
      // network = nhà mạng (dùng phân bổ theo mạng của khách).
      // gateway ← field `provider` của API (owner xác nhận 2026-08-05): KHÔNG dùng `provider`
      // cho network, vì BE truyền thẳng gateway xuống tổng đài — thiếu là không route được cuộc.
      network: str(row, 'network', 'network_name', 'telco', 'carrier') || undefined,
      gateway: str(row, 'provider', 'gateway', 'gateway_name', 'gateway_uuid', 'gatewayName') || undefined,
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
      variables: pickScriptVariables(row),
    }))
    .filter((s) => s.uuid);
  return items.length ? { items } : { items: [], unparsed: sample(payload) };
}

/**
 * Bóc biến kịch bản. Shape chưa chốt (giống mọi field khác ở file này) nên dò nhiều tên;
 * không tìm được thì trả undefined và UI chỉ đơn giản không hiện khối biến.
 */
function pickScriptVariables(row: Record<string, unknown>): ScriptOption['variables'] {
  for (const key of ['variables', 'scriptVariables', 'script_variables', 'collect_info_variables']) {
    const value = row[key];
    if (!Array.isArray(value)) continue;
    const variables = value
      .map((item) => {
        if (typeof item === 'string') return { fieldCode: item };
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const fieldCode = str(obj, 'fieldCode', 'field_code', 'code', 'variable', 'name');
        if (!fieldCode) return null;
        const fieldName = str(obj, 'fieldName', 'field_name', 'label', 'displayName', 'display_name');
        return { fieldCode, fieldName: fieldName || undefined };
      })
      .filter((v): v is { fieldCode: string; fieldName?: string } => !!v);
    if (variables.length > 0) return variables;
  }
  return undefined;
}

/* ============================== Giọng đọc ============================== */

export interface VoiceOption {
  value: string;
  label: string;
  /** Giới tính / vùng miền — app OMICRM thật hiện kèm để chọn giọng dễ hơn. */
  gender?: string;
  region?: string;
}

export async function fetchVoices(): Promise<CatalogResult<VoiceOption>> {
  const payload = await call(`${CHATBOT_BASE}/bot-accent/list-all?${QUERY}`, {
    method: 'POST', body: JSON.stringify({}),
  });
  const rows = pickList(payload);
  if (!rows) return { items: [], unparsed: sample(payload) };
  const items = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    // app thật bỏ giọng bị ẩn khỏi danh sách chọn
    .filter((row) => row.is_hidden_in_list !== true && row.isHiddenInList !== true)
    .map((row) => {
      // value phải KHỚP enum Voice của BE (vd northern_female_ngocanh) — sai là Jackson
      // fail parse và BE bỏ qua toàn bộ config phức, mất luôn sipNumbers
      const value = str(row, 'code', 'accent', 'accent_code', 'value', 'key', 'voice', 'name');
      const label = str(row, 'greeting_name', 'display_name', 'displayName', 'label', 'title', 'lazy_call_name', 'name')
        || value;
      const regions = row.regions ?? row.region;
      return {
        value,
        label,
        gender: (str(row, 'gender') || undefined)?.toLowerCase(),
        region: Array.isArray(regions) ? String(regions[0] ?? '') || undefined : str(row, 'region') || undefined,
      };
    })
    .filter((v) => v.value);
  return items.length ? { items } : { items: [], unparsed: sample(payload) };
}

/* ============================== Mục đích cuộc gọi ============================== */

/** Danh mục tenant tự định nghĩa, nằm ở service CDR. Không bắt buộc khi submit phiên. */
export interface CallPurposeOption { id: string; name: string }

export async function fetchCallPurposes(): Promise<CatalogResult<CallPurposeOption>> {
  // size=0 = lấy hết (quy ước phân trang của OMICRM)
  const payload = await call(`${CDR_BASE}/call_transaction/purpose/get_list?page=1&size=0&${QUERY}`, {
    method: 'POST', body: JSON.stringify({}),
  });
  const rows = pickList(payload);
  if (!rows) return { items: [], unparsed: sample(payload) };
  const items = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((row) => ({
      id: str(row, '_id', 'id'),
      name: str(row, 'name', 'purpose_name', 'title'),
    }))
    .filter((p) => p.id && p.name);
  return items.length ? { items } : { items: [], unparsed: sample(payload) };
}

/* ============================== Thẻ / Nhóm KH / Loại hình ============================== */

/**
 * Danh mục phân loại khách hàng dùng cho tab "Thuộc tính khách hàng" khi nạp data.
 * Cả 3 cùng shape và cùng nằm ở tenant-config nên gọi chung một hàm.
 *
 * Trước đây UI bắt người dùng TỰ GÕ id (`tag_vip, cat_1`) — không ai biết id của mình,
 * nên thực tế là không dùng được. Giờ lấy danh mục thật để chọn.
 */
export interface ClassifyOption {
  id: string;
  name: string;
  color?: string;
  /** Danh mục nhiều cấp (nhóm KH có cấp con). */
  children?: ClassifyOption[];
}

export type ClassifyKind = 'tag' | 'category' | 'business';

const CLASSIFY_PATHS: Record<ClassifyKind, string> = {
  tag: '/tag/search-all',
  category: '/contact-categories/search-all',
  business: '/business/search-all',
};

export async function fetchClassify(kind: ClassifyKind): Promise<CatalogResult<ClassifyOption>> {
  const payload = await call(`${TENANT_CONFIG_BASE}${CLASSIFY_PATHS[kind]}?${QUERY}`, {
    method: 'POST', body: JSON.stringify({ types: [] }),
  });
  const rows = pickList(payload);
  if (!rows) return { items: [], unparsed: sample(payload) };
  const items = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(mapClassifyRow)
    .filter((c): c is ClassifyOption => !!c);
  return items.length ? { items } : { items: [], unparsed: sample(payload) };
}

function mapClassifyRow(row: Record<string, unknown>): ClassifyOption | null {
  const id = str(row, '_id', 'id', 'value');
  const name = str(row, 'name', 'label', 'tag_name', 'category_name', 'business_name', 'title');
  if (!id || !name) return null;
  const rawChildren = row.children ?? row.second_level ?? row.sub_categories;
  const children = Array.isArray(rawChildren)
    ? rawChildren
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map(mapClassifyRow)
        .filter((c): c is ClassifyOption => !!c)
    : undefined;
  return {
    id,
    name,
    color: str(row, 'color') || undefined,
    children: children && children.length > 0 ? children : undefined,
  };
}

/* ============================== Trạng thái khách hàng (filter-contact) ============================== */

/**
 * Một trạng thái khách để chọn làm điều kiện gọi lại.
 *
 * ⚠️ `code` KHÔNG phải id — nó là điểm nối `index`/`secondIndex` mà BE dùng để so với
 * `filterContacts` của khách: `"1"` = cấp 1 index 1 (khớp mọi cấp con), `"1-1"` = đúng cấp 1 index 1
 * VÀ cấp 2 index 1. Gửi id lên là BE không khớp được gì cả.
 */
export interface ContactStatusOption {
  /** Mã gửi lên BE: "1" hoặc "1-1". */
  code: string;
  /** Nhãn hiển thị, ghép "Cha › Con" cho cấp 2 để người dùng biết mình chọn nhánh nào. */
  name: string;
  color?: string;
  /** true = cấp 2 (có secondIndex) — dùng để thụt lề trong danh sách. */
  isSecondLevel?: boolean;
}

/**
 * Danh mục trạng thái khách hàng, dùng cho retry trigger `CONTACT_STATUS`.
 *
 * Endpoint là `POST /filter-contact/list` — KHÔNG phải `search-all` như mấy danh mục phân loại khác
 * (tag/nhóm KH/ngành nghề). Router tenant-config chỉ đăng ký get-by-id/search/list/add/update/delete
 * cho prefix này.
 *
 * Cấu trúc: `values[]` là cấp 1 (`index`, `name`), mỗi phần tử có thể có `second_level[]` là cấp 2
 * (cũng `index`, `name`). Đối chiếu cách web-v2 đọc: `CustomerStatusList.js:24-28`.
 */
export async function fetchContactStatuses(): Promise<CatalogResult<ContactStatusOption>> {
  const payload = await call(`${TENANT_CONFIG_BASE}/filter-contact/list?${QUERY}`, {
    method: 'POST', body: JSON.stringify({}),
  });
  const rows = pickList(payload);
  if (!rows) return { items: [], unparsed: sample(payload) };
  const items: ContactStatusOption[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const values = (row as Record<string, unknown>).values;
    if (!Array.isArray(values)) continue;
    for (const level1 of values) {
      if (!level1 || typeof level1 !== 'object') continue;
      const l1 = level1 as Record<string, unknown>;
      const index = num(l1.index);
      const name = str(l1, 'name');
      if (index === null || !name) continue;
      items.push({ code: String(index), name, color: str(l1, 'color') || undefined });
      const secondLevel = l1.second_level ?? l1.secondLevel;
      if (!Array.isArray(secondLevel)) continue;
      for (const level2 of secondLevel) {
        if (!level2 || typeof level2 !== 'object') continue;
        const l2 = level2 as Record<string, unknown>;
        const secondIndex = num(l2.index);
        const secondName = str(l2, 'name');
        if (secondIndex === null || !secondName) continue;
        items.push({
          code: `${index}-${secondIndex}`,
          name: `${name} › ${secondName}`,
          color: str(l2, 'color') || undefined,
          isSecondLevel: true,
        });
      }
    }
  }
  return items.length ? { items } : { items: [], unparsed: sample(payload) };
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/* ============================== Prefix mã quốc gia ============================== */

/**
 * Prefix mã quốc gia để chuẩn hoá SĐT khi nạp data. App thật merge với ['0','84'] và
 * dedupe theo chính field `prefix`.
 */
export async function fetchPhonePrefixes(): Promise<CatalogResult<string>> {
  const payload = await call(`${TENANT_BASE}/phone_prefix/get_all?${QUERY}`);
  const rows = pickList(payload);
  if (!rows) return { items: [], unparsed: sample(payload) };
  const fromApi = rows
    .map((row) => {
      if (typeof row === 'string' || typeof row === 'number') return String(row).trim();
      if (row && typeof row === 'object') return str(row as Record<string, unknown>, 'prefix', 'code', 'value', 'name');
      return '';
    })
    .filter(Boolean);
  const items = [...new Set(['0', '84', ...fromApi])];
  return fromApi.length ? { items } : { items, unparsed: sample(payload) };
}
