import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    return ok(await getGateway().searchContacts(q));
  } catch (e) {
    return fail(e);
  }
}
