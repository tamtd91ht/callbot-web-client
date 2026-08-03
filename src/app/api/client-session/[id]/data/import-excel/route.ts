/**
 * Import Excel — PARSE SERVER-SIDE tại BFF (quyết định user C-02a):
 * client CHỈ gửi FormData; Route Handler (Node runtime) đọc .xlsx/.csv bằng SheetJS,
 * validate từng dòng rồi đổ vào pipeline ingest (source=EXCEL).
 * Format: cột đầu = phone_number (hoặc header chứa 'phone'/'số'), các cột còn lại = biến.
 * Giới hạn demo: 5MB / 10.000 dòng (real mode: 20MB / 100.000 — docs 02 §3, xử lý async B5).
 */
import * as XLSX from 'xlsx';
import { getGateway } from '@/bff/gateway';
import { fail, ok } from '@/bff/http';
import { GatewayError } from '@/bff/gateway';
import type { ImportExcelResult } from '@/contracts/types';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new GatewayError('CS_FILE_INVALID_FORMAT', 'Thiếu file trong FormData (field "file")');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new GatewayError('CS_FILE_TOO_LARGE', 'File vượt 5MB (giới hạn demo mock)');
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      throw new GatewayError('CS_FILE_INVALID_FORMAT', 'File không có sheet nào');
    }
    const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (table.length === 0) {
      throw new GatewayError('CS_FILE_INVALID_FORMAT', 'Sheet không có dòng dữ liệu');
    }
    if (table.length > MAX_ROWS) {
      throw new GatewayError('CS_FILE_TOO_MANY_ROWS', `File vượt ${MAX_ROWS.toLocaleString('vi-VN')} dòng (giới hạn demo)`);
    }

    // Tìm cột số điện thoại: header chứa phone/sđt/số — fallback cột đầu tiên
    const headers = Object.keys(table[0]);
    const phoneHeader = headers.find((h) => /phone|sdt|sđt|số/i.test(h)) ?? headers[0];

    const errors: ImportExcelResult['errors'] = [];
    const rows = table.map((record, index) => {
      const phoneNumber = String(record[phoneHeader] ?? '').trim();
      const variables: Record<string, string> = {};
      for (const header of headers) {
        if (header !== phoneHeader && String(record[header]).trim() !== '') {
          variables[header] = String(record[header]).trim();
        }
      }
      if (!phoneNumber) {
        errors.push({ row: index + 2, reason: 'Thiếu số điện thoại' }); // +2 = header + 1-based
      }
      return { phoneNumber, variables };
    }).filter((r) => r.phoneNumber);

    const appendMode = form.get('appendMode');
    const result = await getGateway().addManualRows(id, {
      rows,
      source: 'EXCEL',
      appendMode: appendMode === 'RUN_NOW' ? 'RUN_NOW' : appendMode === 'RUN_AFTER' ? 'RUN_AFTER' : undefined,
    });

    const payload: ImportExcelResult = {
      fileName: file.name,
      totalRows: table.length,
      inserted: result.inserted,
      duplicated: result.duplicated,
      invalid: result.invalid + errors.length,
      errors,
    };
    return ok(payload);
  } catch (e) {
    return fail(e);
  }
}
