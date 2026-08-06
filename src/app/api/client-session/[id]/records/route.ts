/** Lịch sử cuộc gọi thực tế của phiên (mock mode) — khác /data là data staging. */
import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';
import type { CallRecordFilter, RecordStatus } from '@/contracts/types';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const params = new URL(request.url).searchParams;
    const statuses = params.get('statuses');
    const filter: CallRecordFilter = {
      page: Number(params.get('page')) || 1,
      size: Number(params.get('size')) || 20,
      statuses: statuses ? (statuses.split(',').filter(Boolean) as RecordStatus[]) : undefined,
      keyword: params.get('keyword') ?? undefined,
    };
    return ok(await getGateway().searchRecords(id, filter));
  } catch (e) {
    return fail(e);
  }
}
