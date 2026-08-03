/**
 * Token JWT gọi callbot-v2-stg — app KHÔNG có luồng auth nên user paste tay qua UI (TokenConfig).
 * Lưu localStorage phía browser; apiClient đính vào header x-callbot-token cho BFF forward đi.
 */
const STORAGE_KEY = 'callbot.jwt';
export const TOKEN_CHANGED_EVENT = 'callbot-token-changed';

export function getToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(STORAGE_KEY) ?? '';
}

/** Chấp nhận paste cả cụm "Bearer eyJ..." lẫn token trần. */
export function normalizeToken(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, '');
}

export function setToken(raw: string): void {
  const token = normalizeToken(raw);
  if (token) window.localStorage.setItem(STORAGE_KEY, token);
  else window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(TOKEN_CHANGED_EVENT));
}

export function clearToken(): void {
  setToken('');
}

/** Đọc claim exp (ms) để UI báo token sắp/đã hết hạn — null nếu không decode được. */
export function tokenExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload)) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}
