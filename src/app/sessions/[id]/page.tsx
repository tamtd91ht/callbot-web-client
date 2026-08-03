'use client';
/**
 * Chi tiết phiên + realtime — restyle theo tokens template (C-02a).
 * Nạp thêm data khi đang chạy dùng CHUNG AddCustomerDrawer (RUN_NOW/RUN_AFTER).
 * DRAFT: nút "Submit" tại đây; realtime qua useSessionRealtime (mock=SSE) — số liệu TUYỆT ĐỐI.
 */
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientSession, DataRow, SessionCounters } from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';
import { get, post, ApiError } from '@/lib/apiClient';
import { useSessionRealtime } from '@/lib/realtime';
import { Button, Card } from '@/components/ui';
import { AddCustomerDrawer } from '@/components/session/AddCustomerDrawer';
import { SessionDataTable } from '@/components/session/SessionDataTable';

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [session, setSession] = useState<ClientSession | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [live, setLive] = useState<{ totalCalling: number; ccu: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSession(await get<ClientSession>(`/api/client-session/${id}`));
      setRows(await get<DataRow[]>(`/api/client-session/${id}/data`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  const { connected } = useSessionRealtime(id, (event: SessionEvent) => {
    if (event.event === 'clientSessionStats') {
      const d = event.data;
      setSession((prev) => (prev ? { ...prev, status: d.status, counters: d.counters } : prev));
      setLive({
        totalCalling: d.totalCalling,
        ccu: d.currentCCU != null ? `${d.currentCCU}/${d.maxCCU ?? '—'}` : '—',
      });
    } else {
      setSession((prev) => (prev ? { ...prev, status: event.data.status, pausedCause: event.data.cause } : prev));
      if (event.data.status === 'COMPLETED' || event.data.status === 'CANCELED') void reload();
    }
  });

  // Real mode (C-03a): chưa nối socket gateway — mất realtime thì poll 10s (số liệu tuyệt đối nên tự khớp)
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [connected, reload]);

  async function act(action: 'submit' | 'pause' | 'resume' | 'cancel') {
    setError(null);
    try {
      setSession(await post<ClientSession>(`/api/client-session/${id}/${action}`));
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  if (!session) return <Card>Đang tải…</Card>;
  const c: Partial<SessionCounters> = session.counters ?? {};
  const canAddData = session.status !== 'COMPLETED' && session.status !== 'CANCELED';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/sessions')}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-(--color-field) hover:bg-gray-200">←</button>
            <div>
              <h1 className="text-lg font-bold">
                {session.name} <span className={`badge ${session.status} align-middle`}>{session.status}</span>
              </h1>
              {session.pausedCause && <div className="text-xs text-amber-700">Tạm dừng: {session.pausedCause}</div>}
              {session.cancelCause && <div className="text-xs text-red-700">Đã huỷ: {session.cancelCause}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs ${connected ? 'text-(--color-primary-dark)' : 'text-(--color-danger)'}`}>
              {connected ? '● realtime' : '○ mất kết nối'}
            </span>
            {session.status === 'DRAFT' && <Button variant="primary" onClick={() => act('submit')}>Submit phiên</Button>}
            <Button disabled={session.status !== 'RUNNING'} onClick={() => act('pause')}>Pause</Button>
            <Button disabled={session.status !== 'PAUSED'} onClick={() => act('resume')}>Resume</Button>
            <Button variant="danger" disabled={!['SCHEDULED', 'RUNNING', 'PAUSED'].includes(session.status)}
              onClick={() => act('cancel')}>Cancel</Button>
            {canAddData && <Button variant="primary" onClick={() => setDrawerOpen(true)}>+ Thêm khách hàng</Button>}
          </div>
        </div>
        {error && <div className="mt-2 text-sm text-(--color-danger)">{error}</div>}
      </Card>

      <Card>
        <h3 className="mb-3 text-[15px] font-bold">Realtime</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Đang gọi" value={live?.totalCalling ?? 0} highlight />
          <Stat label="CCU" value={live?.ccu ?? '—'} />
          <Stat label="Tổng data" value={c.total ?? 0} />
          <Stat label="Còn lại" value={c.remaining ?? 0} />
          <Stat label="Gọi lại" value={c.retried ?? 0} />
          <Stat label="Nghe máy" value={c.answered ?? 0} good />
          <Stat label="Không nghe" value={c.noAnswer ?? 0} />
          <Stat label="Lỗi" value={c.failed ?? 0} bad />
          <Stat label="Trùng" value={c.duplicated ?? 0} />
          <Stat label="Không hợp lệ" value={c.invalid ?? 0} />
        </div>
      </Card>

      <Card>
        <SessionDataTable rows={rows} />
      </Card>

      <AddCustomerDrawer open={drawerOpen} initialTab="manual"
        sessionStatus={session.status}
        onClose={() => { setDrawerOpen(false); void reload(); }}
        ensureSessionId={async () => id}
        onAdded={() => void reload()} />
    </div>
  );
}

function Stat({ label, value, highlight, good, bad }: {
  label: string; value: number | string; highlight?: boolean; good?: boolean; bad?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${
      highlight ? 'border-(--color-primary) bg-(--color-primary-soft)' : 'border-(--color-line) bg-(--color-field)'}`}>
      <div className="text-xs text-(--color-muted)">{label}</div>
      <div className={`text-xl font-bold ${good ? 'text-(--color-primary-dark)' : bad ? 'text-(--color-danger)' : ''}`}>{value}</div>
    </div>
  );
}
