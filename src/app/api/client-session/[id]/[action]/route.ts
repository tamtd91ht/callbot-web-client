import { getGateway, type SessionAction } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';

const ACTIONS: SessionAction[] = ['submit', 'pause', 'resume', 'cancel'];

export async function POST(_request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await ctx.params;
    if (!ACTIONS.includes(action as SessionAction)) {
      return fail(new Error(`Unknown action: ${action}`));
    }
    return ok(await getGateway().doAction(id, action as SessionAction));
  } catch (e) {
    return fail(e);
  }
}
