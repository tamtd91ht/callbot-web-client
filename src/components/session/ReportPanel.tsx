'use client';
/**
 * Báo cáo phiên (B9) — 3 lát cắt lấy từ 3 nguồn khác nhau ở BE:
 * hàng đợi & nguồn data từ index staging, KẾT QUẢ GỌI từ index record.
 * Phiên chưa chạy thì `byCallResult` rỗng (đúng, không phải lỗi).
 */
import { useCallback, useEffect, useState } from 'react';
import type { SessionReport } from '@/contracts/types';
import { ApiError } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { Button } from '../ui';

const ROW_STATUS_LABELS: Record<string, string> = {
  STAGED: 'Chờ gọi', DUPLICATE: 'Trùng', INVALID: 'Lỗi dữ liệu',
  QUEUED: 'Đang vào hàng đợi', DISPATCHED: 'Đã gửi lệnh gọi', DONE: 'Đã xong', REMOVED: 'Đã xoá',
};
const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Thêm thủ công', EXCEL: 'File Excel', CRM: 'Thuộc tính KH', CLONE: 'Clone phiên', THIRD_PARTY: 'Bên thứ 3',
};
const CALL_RESULT_LABELS: Record<string, string> = {
  ANSWERED: 'Nghe máy', NO_ANSWER: 'Không nghe', FAILED: 'Lỗi', CANCELED: 'Đã huỷ', PROCESSING: 'Đang gọi',
};

export function ReportPanel({ sessionId, refreshKey }: { sessionId: string; refreshKey?: number }) {
  const [report, setReport] = useState<SessionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await sessionApi.report(sessionId));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally { setLoading(false); }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[15px] font-bold">Báo cáo</h3>
        {report && (
          <span className="rounded-full bg-(--color-primary-soft) px-3 py-0.5 text-sm font-semibold text-(--color-primary-dark)">
            Tỉ lệ nghe máy {report.answerRate}%
          </span>
        )}
        <Button className="ml-auto" disabled={loading} onClick={() => void load()}>
          {loading ? 'Đang tải…' : 'Làm mới'}
        </Button>
      </div>

      {error && <div className="mb-2 text-sm text-(--color-danger)">{error}</div>}

      {report && (
        <div className="grid gap-4 md:grid-cols-3">
          <Breakdown title="Theo hàng đợi" labels={ROW_STATUS_LABELS} data={report.byRowStatus}
            total={report.totalRows} />
          <Breakdown title="Theo nguồn dữ liệu" labels={SOURCE_LABELS} data={report.bySource} />
          <Breakdown title="Theo kết quả gọi" labels={CALL_RESULT_LABELS} data={report.byCallResult}
            total={report.finishedCalls}
            emptyHint="Phiên chưa chạy cuộc nào" />
        </div>
      )}
    </div>
  );
}

function Breakdown({ title, labels, data, total, emptyHint }: {
  title: string;
  labels: Record<string, string>;
  data: Record<string, number>;
  total?: number;
  emptyHint?: string;
}) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const sum = entries.reduce((acc, [, v]) => acc + v, 0);
  return (
    <div className="rounded-xl border border-(--color-line) p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{title}</span>
        {total != null && <span className="text-xs text-(--color-muted)">{total.toLocaleString('vi-VN')}</span>}
      </div>
      {entries.length === 0 ? (
        <div className="text-sm text-(--color-muted)">{emptyHint ?? 'Chưa có dữ liệu'}</div>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([key, value]) => (
            <div key={key}>
              <div className="flex items-baseline justify-between text-sm">
                <span>{labels[key] ?? key}</span>
                <span className="font-semibold">{value.toLocaleString('vi-VN')}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-(--color-field)">
                <div className="h-full bg-(--color-navy)"
                  style={{ width: `${sum === 0 ? 0 : Math.round((value / sum) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
