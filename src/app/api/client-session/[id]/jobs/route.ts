/**
 * Job nền của phiên: GET = danh sách đợt xử lý (import/recheck/export) để UI hiện tiến độ và
 * lấy link file; POST = kích hoạt job (recheck / export / import CRM).
 * Real mode chạy nền nên UI poll route này; mock mode job xong ngay, poll vẫn trả đúng lịch sử.
 */
import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';
import { GatewayError } from '@/bff/gateway';
import type { CrmContactFilter } from '@/contracts/types';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return ok(await getGateway().listImportBatches(id));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      action?: 'recheck' | 'export' | 'import-crm' | 'preview-crm';
      rowStatuses?: string[];
      filter?: CrmContactFilter;
      appendMode?: 'RUN_NOW' | 'RUN_AFTER';
    };
    const gateway = getGateway();
    switch (body.action) {
      case 'recheck':
        return ok(await gateway.recheckDedupe(id));
      case 'export':
        return ok(await gateway.exportData(id, body.rowStatuses));
      case 'preview-crm':
        return ok({ estimatedCount: await gateway.previewCrm(id, body.filter ?? {}) });
      case 'import-crm':
        return ok(await gateway.importCrm(id, body.filter ?? {}, body.appendMode));
      default:
        throw new GatewayError('CS_INVALID_CONFIG', `action không hợp lệ: ${body.action}`);
    }
  } catch (e) {
    return fail(e);
  }
}
