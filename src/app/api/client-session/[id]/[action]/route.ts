import { getGateway, type SessionAction } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';

const ACTIONS: SessionAction[] = ['submit', 'pause', 'resume', 'cancel'];

export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await ctx.params;
    if (!ACTIONS.includes(action as SessionAction)) {
      return fail(new Error(`Unknown action: ${action}`));
    }
    // pause/cancel có thể kèm lý do; pause có thể kèm thời lượng. Body rỗng là bình thường.
    let cause: string | undefined;
    let pauseMinutes: number | undefined;
    try {
      const body = await request.json() as { cause?: string; pauseMinutes?: number } | null;
      cause = body?.cause;
      pauseMinutes = body?.pauseMinutes;
    } catch {
      /* không có body JSON — bỏ qua */
    }
    return ok(await getGateway().doAction(id, action as SessionAction, cause, pauseMinutes));
  } catch (e) {
    return fail(e);
  }
}
