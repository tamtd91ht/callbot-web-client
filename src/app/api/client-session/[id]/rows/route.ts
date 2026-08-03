/**
 * Thao tác trên 1 dòng data (B7): PATCH = sửa SĐT/biến (BE tự re-validate + tính lại trùng),
 * POST = khôi phục dòng trùng về hàng đợi gọi.
 */
import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';
import { GatewayError } from '@/bff/gateway';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      rowId?: string;
      phoneNumber?: string;
      variables?: Record<string, string>;
    };
    if (!body.rowId) throw new GatewayError('CS_INVALID_CONFIG', 'Thiếu rowId');
    return ok(await getGateway().updateRow(id, body.rowId, {
      phoneNumber: body.phoneNumber,
      variables: body.variables,
    }));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json()) as { rowId?: string };
    if (!body.rowId) throw new GatewayError('CS_INVALID_CONFIG', 'Thiếu rowId');
    return ok(await getGateway().restoreDuplicate(id, body.rowId));
  } catch (e) {
    return fail(e);
  }
}
