'use client';
/** Danh sách phiên — restyle theo tokens template; tạo phiên chuyển sang màn /sessions/new (C-02a). */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ClientSession } from '@/contracts/types';
import { get } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { Button, Card } from '@/components/ui';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSessions(await sessionApi.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(reload, 5000); // list poll nhẹ; màn chi tiết dùng realtime
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
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

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-(--color-line) text-left text-(--color-muted)">
            <th className="px-3 py-2 font-semibold">Tên phiên</th>
            <th className="px-3 py-2 font-semibold">Trạng thái</th>
            <th className="px-3 py-2 font-semibold">Mục đích</th>
            <th className="px-3 py-2 font-semibold">Tổng data</th>
            <th className="px-3 py-2 font-semibold">Còn lại</th>
            <th className="px-3 py-2 font-semibold">Nghe máy</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-b border-(--color-line) last:border-0 hover:bg-gray-50">
              <td className="px-3 py-3 font-medium">{s.name}</td>
              <td className="px-3 py-3">
                <span className={`badge ${s.status}`}>{s.status}</span>
                {s.pausedCause && <div className="mt-0.5 text-xs text-amber-700">{s.pausedCause}</div>}
              </td>
              <td className="px-3 py-3 text-(--color-muted)">{s.purpose ?? '—'}</td>
              <td className="px-3 py-3">{s.counters?.total ?? 0}</td>
              <td className="px-3 py-3">{s.counters?.remaining ?? 0}</td>
              <td className="px-3 py-3">{s.counters?.answered ?? 0}</td>
              <td className="px-3 py-3 text-right">
                <Link className="text-(--color-link) hover:underline" href={`/sessions/${s.id}`}>
                  {s.status === 'DRAFT' ? 'Tiếp tục nháp →' : 'Chi tiết →'}
                </Link>
              </td>
            </tr>
          ))}
          {sessions.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-(--color-muted)">
                Chưa có phiên nào — bấm <b>+ Tạo phiên</b> để bắt đầu.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
