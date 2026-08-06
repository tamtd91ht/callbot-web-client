'use client';
/**
 * Danh sách phiên — bám màn danh sách AutoCall (web-v2 MarketingAutoCallListV2:
 * filter trạng thái, tìm theo tên, cột tiến độ, vào chi tiết / tiếp tục nháp).
 *
 * LỌC & SẮP XẾP CHẠY PHÍA CLIENT — không phải lựa chọn thiết kế: endpoint
 * POST /client-session/search của BE hiện chỉ đọc {page,size} và BỎ QUA mọi filter
 * (status/keyword/thời gian), lại không trả total nên không dựng được phân trang server-side.
 * Đã ghi vào danh sách nợ BE; khi BE bổ sung thì chuyển các filter dưới đây thành tham số request.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClientSession, ClientSessionStatus } from '@/contracts/types';
import { sessionApi } from '@/lib/sessionApi';
import { Button, Card } from '@/components/ui';

const STATUS_FILTERS: Array<{ key: 'ALL' | ClientSessionStatus; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'DRAFT', label: 'Nháp' },
  { key: 'SCHEDULED', label: 'Chờ chạy' },
  { key: 'RUNNING', label: 'Đang chạy' },
  { key: 'PAUSED', label: 'Tạm dừng' },
  { key: 'COMPLETED', label: 'Hoàn tất' },
  { key: 'CANCELED', label: 'Đã huỷ' },
];

const STATUS_LABELS: Record<ClientSessionStatus, string> = {
  DRAFT: 'Nháp', SCHEDULED: 'Chờ chạy', RUNNING: 'Đang chạy',
  PAUSED: 'Tạm dừng', COMPLETED: 'Hoàn tất', CANCELED: 'Đã huỷ',
};

type SortKey = 'newest' | 'name' | 'total';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'ALL' | ClientSessionStatus>('ALL');
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setSessions(await sessionApi.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(reload, 5000); // list poll nhẹ; màn chi tiết dùng realtime
    return () => clearInterval(timer);
  }, [reload]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => map.set(s.status, (map.get(s.status) ?? 0) + 1));
    return map;
  }, [sessions]);

  const visible = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    const filtered = sessions.filter((s) => {
      if (status !== 'ALL' && s.status !== status) return false;
      if (needle && !s.name.toLowerCase().includes(needle)) return false;
      return true;
    });
    const sorted = [...filtered];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    else if (sort === 'total') sorted.sort((a, b) => (b.counters?.total ?? 0) - (a.counters?.total ?? 0));
    else sorted.sort((a, b) => b.createdTimeMs - a.createdTimeMs);
    return sorted;
  }, [sessions, status, keyword, sort]);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Phiên gọi callbot</h1>
          <div className="mt-1 h-1 w-8 rounded bg-(--color-primary)" />
        </div>
        <Link href="/sessions/new">
          <Button variant="primary" className="px-6">+ Tạo phiên</Button>
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((filter) => {
            const count = filter.key === 'ALL' ? sessions.length : counts.get(filter.key) ?? 0;
            return (
              <button key={filter.key} type="button" onClick={() => setStatus(filter.key)}
                className={`rounded-full px-3.5 py-1 text-[13px] font-medium transition ${
                  status === filter.key
                    ? 'bg-(--color-navy) text-white'
                    : 'bg-(--color-field) text-(--color-ink) hover:bg-gray-200'}`}>
                {filter.label}
                <span className="ml-1.5 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="Tìm theo tên phiên…"
            className="w-52 rounded-(--radius-field) border border-(--color-line) px-3 py-1.5 text-sm outline-none focus:border-(--color-primary)" />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-(--radius-field) border border-(--color-line) px-3 py-1.5 text-sm outline-none focus:border-(--color-primary)">
            <option value="newest">Mới nhất</option>
            <option value="name">Tên A→Z</option>
            <option value="total">Nhiều data nhất</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-200 text-sm">
          <thead>
            <tr className="border-b border-(--color-line) text-left text-(--color-muted)">
              <th className="px-3 py-2 font-semibold">Tên phiên</th>
              <th className="px-3 py-2 font-semibold">Trạng thái</th>
              <th className="px-3 py-2 font-semibold">Mục đích</th>
              <th className="px-3 py-2 font-semibold">Tiến độ</th>
              <th className="px-3 py-2 text-right font-semibold">Tổng data</th>
              <th className="px-3 py-2 text-right font-semibold">Nghe máy</th>
              <th className="px-3 py-2 font-semibold">Tạo lúc</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const total = s.counters?.total ?? 0;
              const done = Math.max(0, total - (s.counters?.remaining ?? 0));
              const percent = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <tr key={s.id} className="border-b border-(--color-line) last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-3 font-medium">{s.name}</td>
                  <td className="px-3 py-3">
                    <span className={`badge ${s.status}`}>{STATUS_LABELS[s.status] ?? s.status}</span>
                    {s.pausedCause && <div className="mt-0.5 text-xs text-amber-700">{s.pausedCause}</div>}
                    {s.cancelCause && <div className="mt-0.5 text-xs text-red-700">{s.cancelCause}</div>}
                  </td>
                  <td className="px-3 py-3 text-(--color-muted)">{s.purpose ?? '—'}</td>
                  <td className="px-3 py-3">
                    {s.status === 'DRAFT' || total === 0 ? (
                      <span className="text-(--color-muted)">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-(--color-line)">
                          <div className="h-full rounded-full bg-(--color-primary)" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="text-xs text-(--color-muted)">{percent}%</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">{total.toLocaleString('vi-VN')}</td>
                  <td className="px-3 py-3 text-right text-(--color-primary-dark)">
                    {(s.counters?.answered ?? 0).toLocaleString('vi-VN')}
                  </td>
                  <td className="px-3 py-3 text-xs text-(--color-muted)">
                    {s.createdTimeMs ? new Date(s.createdTimeMs).toLocaleString('vi-VN') : '—'}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <Link className="text-(--color-link) hover:underline" href={`/sessions/${s.id}`}>
                      {s.status === 'DRAFT' ? 'Tiếp tục nháp →' : 'Chi tiết →'}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && loaded && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-(--color-muted)">
                  {sessions.length === 0
                    ? <>Chưa có phiên nào — bấm <b>+ Tạo phiên</b> để bắt đầu.</>
                    : 'Không có phiên nào khớp bộ lọc.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
