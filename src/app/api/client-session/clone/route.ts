/**
 * Nhân bản phiên (mock mode) — tương đương "Gọi lại phiên" của AutoCall.
 *
 * Đặt ở /client-session/clone (không phải /client-session/[id]/clone) để không đụng segment
 * động [id]; sourceSessionId nằm trong body, giống contract BE thật.
 */
import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';
import type { CloneSessionRequest } from '@/contracts/types';

export async function POST(request: Request) {
  try {
    const body = await request.json() as CloneSessionRequest;
    if (!body?.sourceSessionId) return fail(new Error('sourceSessionId is required'));
    return ok(await getGateway().cloneSession(body));
  } catch (e) {
    return fail(e);
  }
}
