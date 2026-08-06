'use client';
/**
 * Lịch sử cuộc gọi thực tế — tương đương bảng "Lịch sử gọi" ở màn chi tiết phiên AutoCall
 * (web-v2 MACrudPreviewV2: filter trạng thái/đầu số, cột thời lượng, ghi âm, lần gọi).
 *
 * PHÂN BIỆT với SessionDataTable: bảng kia là DATA STAGING (mỗi khách 1 dòng, có trạng thái
 * trùng/không hợp lệ), bảng này là CUỘC GỌI (1 khách bị retry 3 lần → 3 dòng). Người vận hành
 * cần cả hai và thường lẫn — nên tách tab và ghi rõ ở phần chú thích.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CallRecord, ClientSession, RecordStatus } from '@/contracts/types';
import { ApiError } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { Button } from '../ui';

const PAGE_SIZE = 20;

const STATUS_TABS: Array<{ key: 'ALL' | RecordStatus; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'ANSWERED', label: 'Nghe máy' },
  { key: 'NO_ANSWER', label: 'Không nghe' },
  { key: 'FAILED', label: 'Lỗi' },
  { key: 'PROCESSING', label: 'Đang gọi' },
  { key: 'CANCELED', label: 'Đã huỷ' },
];

const STATUS_STYLE: Record<RecordStatus, { label: string; className: string }> = {
  ANSWERED: { label: 'Nghe máy', className: 'bg-(--color-primary-soft) text-(--color-primary-dark)' },
  NO_ANSWER: { label: 'Không nghe', className: 'bg-amber-50 text-amber-800' },
  FAILED: { label: 'Lỗi', className: 'bg-red-50 text-red-700' },
  PROCESSING: { label: 'Đang gọi', className: 'bg-sky-50 text-sky-700' },
  CANCELED: { label: 'Đã huỷ', className: 'bg-gray-100 text-gray-600' },
};

export function CallHistoryTable({ session, refreshKey }: { session: ClientSession; refreshKey?: number }) {
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'ALL' | RecordStatus>('ALL');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await sessionApi.searchRecords(session, {
        page,
        size: PAGE_SIZE,
        statuses: status === 'ALL' ? undefined : [status],
        keyword: appliedKeyword || undefined,
      });
      setRecords(result.items);
      setTotal(result.total);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session, page, status, appliedKeyword]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // đổi filter thì về trang 1, nếu không sẽ rơi vào trang trống
  useEffect(() => { setPage(1); }, [status, appliedKeyword]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const notSubmitted = !session.runtimeSessionId && session.status === 'DRAFT';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold">Lịch sử cuộc gọi</h3>
          <p className="mt-0.5 text-xs text-(--color-muted)">
            Mỗi lần gọi là một dòng — khách bị gọi lại sẽ xuất hiện nhiều lần.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setAppliedKeyword(keyword.trim()); }}
            placeholder="Tìm số điện thoại hoặc tên…"
            className="w-56 rounded-(--radius-field) border border-(--color-line) px-3 py-1.5 text-sm outline-none focus:border-(--color-primary)" />
          <Button onClick={() => setAppliedKeyword(keyword.trim())}>Tìm</Button>
          <Button onClick={() => void load()}>Làm mới</Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUS_TABS.map((tab) => (
          <button key={tab.key} type="button" onClick={() => setStatus(tab.key)}
            className={`rounded-full px-3.5 py-1 text-[13px] font-medium transition ${
              status === tab.key
                ? 'bg-(--color-navy) text-white'
                : 'bg-(--color-field) text-(--color-ink) hover:bg-gray-200'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</div>}

      {notSubmitted ? (
        <p className="py-6 text-center text-sm text-(--color-muted)">
          Phiên chưa submit nên chưa có cuộc gọi nào.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 text-sm">
              <thead className="bg-(--color-field) text-left text-xs text-(--color-muted)">
                <tr>
                  <Th className="w-12">#</Th>
                  <Th>Số khách hàng</Th>
                  <Th>Trạng thái</Th>
                  <Th>Đầu số gọi</Th>
                  <Th className="text-right">Lần gọi</Th>
                  <Th className="text-right">Thời lượng</Th>
                  <Th>Thời điểm gọi</Th>
                  <Th>Ghi chú</Th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, index) => {
                  const style = STATUS_STYLE[record.status];
                  return (
                    <tr key={`${record.recordId}_${index}`} className="border-t border-(--color-line)">
                      <Td className="text-(--color-muted)">{(page - 1) * PAGE_SIZE + index + 1}</Td>
                      <Td>
                        <span className="font-medium">{record.phoneNumber}</span>
                        {record.variables?.full_name && (
                          <span className="ml-2 text-xs text-(--color-muted)">{record.variables.full_name}</span>
                        )}
                      </Td>
                      <Td>
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.className}`}>
                          {style.label}
                        </span>
                      </Td>
                      <Td className="text-(--color-muted)">{record.sipNumber || '—'}</Td>
                      <Td className="text-right">
                        {record.callIndex && record.callIndex > 1
                          ? <span className="font-semibold text-amber-700">lần {record.callIndex}</span>
                          : (record.callIndex ?? '—')}
                      </Td>
                      <Td className="text-right">{formatDuration(record.duration)}</Td>
                      <Td className="text-(--color-muted)">{formatTime(record.startTimeMs)}</Td>
                      <Td>
                        {record.recordingUrl && (
                          <a href={record.recordingUrl} target="_blank" rel="noreferrer"
                            className="mr-2 text-(--color-link) hover:underline">Ghi âm</a>
                        )}
                        {record.errorMessage && (
                          <span className="text-xs text-red-700">{record.errorMessage}</span>
                        )}
                        {!record.recordingUrl && !record.errorMessage && (
                          <span className="text-(--color-muted)">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
                {records.length === 0 && !loading && (
                  <tr><td colSpan={8} className="py-6 text-center text-sm text-(--color-muted)">
                    Không có cuộc gọi nào khớp bộ lọc
                  </td></tr>
                )}
                {loading && records.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-sm text-(--color-muted)">Đang tải…</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-(--color-muted)">
              {total.toLocaleString('vi-VN')} cuộc gọi
              {loading && records.length > 0 && ' · đang cập nhật…'}
            </span>
            <div className="flex items-center gap-2">
              <Button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Trước</Button>
              <span className="text-(--color-muted)">Trang {page}/{pageCount}</span>
              <Button disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Sau</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}p ${String(seconds % 60).padStart(2, '0')}s`;
}

function formatTime(ms?: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
