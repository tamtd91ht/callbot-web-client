import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return ok(await getGateway().getSession(id));
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const patch = await request.json();
    return ok(await getGateway().updateSession(id, patch));
  } catch (e) {
    return fail(e);
  }
}
