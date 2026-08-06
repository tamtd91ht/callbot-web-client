/**
 * Danh mục kịch bản callbot (mock mode). Real mode FE gọi thẳng gateway chatbot
 * (lib/catalogApi.ts) nên route này chỉ phục vụ demo không cần backend.
 */
import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';

export async function GET(request: Request) {
  try {
    const uuids = new URL(request.url).searchParams.get('uuids');
    const scripts = await getGateway().listScripts();
    if (!uuids) return ok(scripts);
    const wanted = new Set(uuids.split(',').filter(Boolean));
    return ok(scripts.filter((s) => wanted.has(s.uuid)));
  } catch (e) {
    return fail(e);
  }
}
