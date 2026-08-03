'use client';
/**
 * Job nền của phiên (B5/B6/B7/B10): nạp data, tính lại trùng, export.
 * Real mode chạy nền → panel tự poll 3s khi còn job chưa xong rồi dừng, không poll vô hạn.
 * Mock mode job xong ngay nên chỉ hiện lịch sử.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ImportBatch } from '@/contracts/types';
import { ApiError } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { Button } from '../ui';

const TYPE_LABELS: Record<string, string> = {
  IMPORT: 'Nạp dữ liệu', RECHECK: 'Tính lại trùng', EXPORT: 'Xuất dữ liệu',
};
const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'thủ công', EXCEL: 'Excel', CRM: 'danh bạ CRM', CLONE: 'clone phiên', THIRD_PARTY: 'bên thứ 3',
};
const STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'Đang chờ xử lý', PROCESSING: 'Đang chạy', DONE: 'Xong', FAILED: 'Thất bại',
};

export function JobsPanel({
  sessionId, isDraft, onFinished,
}: { sessionId: string; isDraft: boolean; onFinished?: () => void }) {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setBatches(await sessionApi.listJobs(sessionId));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [sessionId]);

  useEffect(() => { void reload(); }, [reload]);

  const running = batches.some((b) => b.status === 'RECEIVED' || b.status === 'PROCESSING');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void reload().then(() => onFinished?.());
    }, 3000);
    return () => clearInterval(timer);
  }, [running, reload, onFinished]);

  async function trigger(action: 'recheck' | 'export') {
    setBusy(true); setError(null);
    try {
      await (action === 'recheck' ? sessionApi.recheckDedupe(sessionId) : sessionApi.exportData(sessionId));
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold">Xử lý nền</h3>
        <span className="text-xs text-(--color-muted)">
          {running ? 'đang chạy — tự cập nhật mỗi 3 giây' : 'không có việc nào đang chạy'}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {isDraft && (
            <Button disabled={busy || running} onClick={() => trigger('recheck')}
              title="Chạy lại toàn bộ kiểm tra trùng — dùng khi vừa đổi cách check trùng">
              Tính lại trùng
            </Button>
          )}
          <Button variant="primary" disabled={busy} onClick={() => trigger('export')}>Xuất Excel</Button>
        </span>
      </div>

      {error && <div className="mb-2 text-sm text-(--color-danger)">{error}</div>}

      {batches.length === 0 ? (
        <div className="rounded-xl bg-(--color-field) px-4 py-3 text-sm text-(--color-muted)">
          Chưa có đợt xử lý nào. Import Excel / nạp danh bạ CRM / xuất dữ liệu sẽ hiện tiến độ ở đây.
        </div>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => <JobRow key={b.id} batch={b} />)}
        </div>
      )}
    </div>
  );
}

function JobRow({ batch }: { batch: ImportBatch }) {
  const total = batch.totalRows ?? 0;
  const processed = batch.processedRows ?? 0;
  // total chỉ biết được sau khi đọc xong file → khi chưa có, hiện số dòng đã xử lý thay vì %
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null;
  const isExport = batch.type === 'EXPORT';
  const failed = batch.status === 'FAILED';

  return (
    <div className="rounded-xl border border-(--color-line) px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          {TYPE_LABELS[batch.type ?? 'IMPORT'] ?? batch.type}
          {batch.source && ` (${SOURCE_LABELS[batch.source] ?? batch.source})`}
        </span>
        <span className={failed ? 'text-(--color-danger)' : batch.status === 'DONE' ? 'text-(--color-primary-dark)' : 'text-amber-700'}>
          {STATUS_LABELS[batch.status] ?? batch.status}
        </span>
        {batch.createdTimeMs && (
          <span className="ml-auto text-xs text-(--color-muted)">
            {new Date(batch.createdTimeMs).toLocaleString('vi-VN')}
          </span>
        )}
      </div>

      {batch.status !== 'DONE' && !failed && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-(--color-field)">
            <div className="h-full bg-(--color-primary) transition-[width]"
              style={{ width: `${percent ?? 30}%` }} />
          </div>
          <div className="mt-1 text-xs text-(--color-muted)">
            {percent != null ? `${processed.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} dòng` : `Đã xử lý ${processed.toLocaleString('vi-VN')} dòng`}
          </div>
        </div>
      )}

      {batch.status === 'DONE' && !isExport && (
        <div className="mt-1 flex flex-wrap gap-4 text-xs">
          <span className="text-(--color-primary-dark)">Thêm mới: {(batch.inserted ?? 0).toLocaleString('vi-VN')}</span>
          <span className="text-amber-700">Trùng: {(batch.duplicated ?? 0).toLocaleString('vi-VN')}</span>
          <span className="text-(--color-danger)">Không hợp lệ: {(batch.invalid ?? 0).toLocaleString('vi-VN')}</span>
        </div>
      )}

      {batch.status === 'DONE' && isExport && (
        <div className="mt-1 text-xs text-(--color-muted)">
          {(batch.totalRows ?? 0).toLocaleString('vi-VN')} dòng
          {batch.fileKey && <> · file: <code className="text-(--color-link)">{batch.fileName ?? batch.fileKey}</code></>}
        </div>
      )}

      {batch.errorFileKey && (
        <div className="mt-1 text-xs">
          <span className="text-(--color-muted)">File dòng lỗi/trùng: </span>
          <code className="text-(--color-link)">{batch.errorFileKey}</code>
        </div>
      )}

      {failed && batch.failReason && (
        <div className="mt-1 text-xs text-(--color-danger)">{batch.failReason}</div>
      )}
    </div>
  );
}
