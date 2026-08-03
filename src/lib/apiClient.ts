/** Fetch wrapper phía browser — bóc envelope {code,message,data}, ném lỗi kèm errorCode CS_*. */
import type { ApiEnvelope } from '@/contracts/types';
import { errorMessage } from '@/contracts/errorCodes';

export class ApiError extends Error {
  constructor(public readonly errorCode: string | undefined, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
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
