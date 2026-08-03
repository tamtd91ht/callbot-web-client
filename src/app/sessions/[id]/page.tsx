'use client';
/**
 * Chi tiết phiên + realtime — SKELETON demo trọn luồng: nạp data → submit → theo dõi →
 * pause/resume/cancel → nạp thêm khi đang chạy (RUN_NOW/RUN_AFTER) → hoàn thành.
 * Realtime qua useSessionRealtime (mock=SSE, real=socket ở C-03) — số liệu là SỐ TUYỆT ĐỐI.
 */
import { use, useCallback, useEffect, useState } from 'react';
import type { ClientSession, DataRow, SessionCounters, AppendMode } from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';
import { get, post, ApiError } from '@/lib/apiClient';
import { useSessionRealtime } from '@/lib/realtime';

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [live, setLive] = useState<{ totalCalling: number; ccu: string } | null>(null);
  const [phones, setPhones] = useState('0987000001\n0987000002\n0987000003\n0987000001\nabc');
  const [appendMode, setAppendMode] = useState<AppendMode>('RUN_AFTER');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setSession(await get<ClientSession>(`/api/client-session/${id}`));
    setRows(await get<DataRow[]>(`/api/client-session/${id}/data`));
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
      // lifecycle: cập nhật badge + refetch data khi kết thúc
      setSession((prev) => (prev ? { ...prev, status: event.data.status } : prev));
      if (event.data.status === 'COMPLETED' || event.data.status === 'CANCELED') void reload();
    }
  });

  async function act(action: 'submit' | 'pause' | 'resume' | 'cancel') {
    setError(null);
    try {
      setSession(await post<ClientSession>(`/api/client-session/${id}/${action}`));
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function addRows() {
    setError(null);
    try {
      const list = phones.split('\n').map((p) => p.trim()).filter(Boolean)
        .map((phoneNumber) => ({ phoneNumber, variables: { full_name: `KH ${phoneNumber.slice(-4)}` } }));
      await post(`/api/client-session/${id}/data`, { rows: list, appendMode });
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  if (!session) return <div className="card">Đang tải…</div>;
  const c: Partial<SessionCounters> = session.counters ?? {};
  const running = session.status === 'RUNNING' || session.status === 'SCHEDULED';

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>
            {session.name} <span className={`badge ${session.status}`}>{session.status}</span>
            {session.pausedCause && <small style={{ marginLeft: 8, color: '#93370d' }}>({session.pausedCause})</small>}
          </h2>
          <div className="row">
            <small style={{ color: connected ? '#05603a' : '#912018' }}>{connected ? '● realtime' : '○ mất kết nối (poll)'}</small>
            <button className="primary" disabled={session.status !== 'DRAFT'} onClick={() => act('submit')}>Submit</button>
            <button disabled={session.status !== 'RUNNING'} onClick={() => act('pause')}>Pause</button>
            <button disabled={session.status !== 'PAUSED'} onClick={() => act('resume')}>Resume</button>
            <button disabled={!['SCHEDULED', 'RUNNING', 'PAUSED'].includes(session.status)} onClick={() => act('cancel')}>Cancel</button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <h3>Realtime</h3>
        <div className="stats-grid">
          <Stat label="Đang gọi" value={live?.totalCalling ?? 0} />
          <Stat label="CCU" value={live?.ccu ?? '—'} />
          <Stat label="Tổng data" value={c.total ?? 0} />
          <Stat label="Còn lại" value={c.remaining ?? 0} />
          <Stat label="Nghe máy" value={c.answered ?? 0} />
          <Stat label="Không nghe" value={c.noAnswer ?? 0} />
          <Stat label="Lỗi" value={c.failed ?? 0} />
          <Stat label="Gọi lại" value={c.retried ?? 0} />
          <Stat label="Trùng" value={c.duplicated ?? 0} />
          <Stat label="Không hợp lệ" value={c.invalid ?? 0} />
        </div>
      </div>

      <div className="card">
        <h3>Nạp data (nhập tay — Excel/CRM ở C-02)</h3>
        <textarea rows={4} value={phones} onChange={(e) => setPhones(e.target.value)} placeholder="Mỗi dòng 1 số điện thoại" />
        <div className="row" style={{ marginTop: 8 }}>
          {running && (
            <select value={appendMode} onChange={(e) => setAppendMode(e.target.value as AppendMode)} style={{ width: 220 }}>
              <option value="RUN_AFTER">Chạy sau khi data cũ xong</option>
              <option value="RUN_NOW">Chạy ngay (chen hàng)</option>
            </select>
          )}
          <button className="primary" onClick={addRows}>Thêm data</button>
        </div>
      </div>

      <div className="card">
        <h3>Data phiên ({rows.length})</h3>
        <table>
          <thead>
            <tr><th>SĐT</th><th>Trạng thái hàng đợi</th><th>Kết quả gọi</th><th>Nguồn</th><th>Lý do</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((r) => (
              <tr key={r.rowId}>
                <td>{r.phoneNumber}</td>
                <td>{r.rowStatus}</td>
                <td>{r.callResult ?? '—'}</td>
                <td>{r.source}</td>
                <td>{r.invalidReason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 100 && <small style={{ color: '#667085' }}>Hiển thị 100/{rows.length} dòng (paging thật ở C-02)</small>}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
