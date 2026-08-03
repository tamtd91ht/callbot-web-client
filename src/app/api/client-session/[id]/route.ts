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
