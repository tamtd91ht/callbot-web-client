/** Fetch wrapper phía browser — bóc envelope {code,message,data}, ném lỗi kèm errorCode CS_*. */
import type { ApiEnvelope } from '@/contracts/types';
import { errorMessage } from '@/contracts/errorCodes';
import { getToken } from './token';

export class ApiError extends Error {
  constructor(public readonly errorCode: string | undefined, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  // Upload file: KHÔNG được set Content-Type — fetch phải tự thêm boundary của multipart,
  // set 'application/json' ở đây là server không parse được form.
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { 'x-callbot-token': token } : {}),
      ...init?.headers,
    },
  });
  const envelope = (await res.json()) as ApiEnvelope<T>;
  if (envelope.code !== 200) {
    throw new ApiError(envelope.errorCode, errorMessage(envelope.errorCode, envelope.message));
  }
  return envelope.data;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const patch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
export const del = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'DELETE', body: JSON.stringify(body ?? {}) });
