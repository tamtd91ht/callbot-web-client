import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const statuses = new URL(request.url).searchParams.get('statuses')?.split(',').filter(Boolean);
    return ok(await getGateway().searchRows(id, statuses));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await request.json();
    return ok(await getGateway().addManualRows(id, body));
  } catch (e) {
    return fail(e);
  }
}
