/** Báo cáo 1 phiên (B9): hàng đợi + nguồn data + kết quả gọi + tỉ lệ nghe máy. */
import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return ok(await getGateway().report(id));
  } catch (e) {
    return fail(e);
  }
}
