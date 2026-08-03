'use client';
/**
 * Danh sách phiên + tạo nhanh — SKELETON để demo luồng (UI thật chờ mẫu, ticket C-02).
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ClientSession } from '@/contracts/types';
import { get, post, ApiError } from '@/lib/apiClient';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setSessions(await get<ClientSession[]>('/api/client-session'));
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(reload, 5000); // list poll nhẹ; màn chi tiết mới dùng realtime
    return () => clearInterval(timer);
  }, [reload]);

  async function createSession() {
    setError(null);
    try {
      const session = await post<ClientSession>('/api/client-session', {
        name: name || `Phiên demo ${new Date().toLocaleTimeString('vi-VN')}`,
        sipNumbers: [{ number: '842873001111', network: 'viettel' }],
        batchSize: 20,
        batchIntervalSeconds: 30,
        dedupeConfig: { mode: 'PHONE' },
        retryConfig: { trigger: 'NO_ANSWER', maxRetry: 1, delaySeconds: 60 },
      });
      setName('');
      window.location.href = `/sessions/${session.id}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="card">
        <h2>Tạo phiên mới (rút gọn — wizard đầy đủ ở C-02)</h2>
        <div className="row">
          <div style={{ flex: 1 }}>
            <input placeholder="Tên phiên" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="primary" onClick={createSession}>Tạo phiên nháp</button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <h2>Danh sách phiên</h2>
        <table>
          <thead>
            <tr>
              <th>Tên</th><th>Trạng thái</th><th>Tổng data</th><th>Còn lại</th><th>Nghe máy</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                <td>{s.counters?.total ?? 0}</td>
                <td>{s.counters?.remaining ?? 0}</td>
                <td>{s.counters?.answered ?? 0}</td>
                <td><Link href={`/sessions/${s.id}`}>Chi tiết →</Link></td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr><td colSpan={6} style={{ color: '#667085' }}>Chưa có phiên nào — tạo phiên đầu tiên ở trên.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
