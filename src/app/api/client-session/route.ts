import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';

export async function GET() {
  try {
    return ok(await getGateway().listSessions());
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return ok(await getGateway().createSession(body));
  } catch (e) {
    return fail(e);
  }
}
