'use client';
/** Bảng data phiên (template img_3): filter Hình thức + tab trạng thái + search + pagination. */
import { useMemo, useState } from 'react';
import type { DataRow } from '@/contracts/types';
import { Button } from '../ui';

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Thêm thủ công', EXCEL: 'File Excel', CRM: 'Thuộc tính KH', THIRD_PARTY: 'Bên thứ 3', CLONE: 'Clone',
  // nguồn luồng CŨ (real mode xem phiên cũ trên stg)
  WEB: 'Web (luồng cũ)', API: 'API (luồng cũ)', CAMPAIGN: 'Campaign (luồng cũ)',
};
const STATUS_TABS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'STAGED', label: 'Chờ gọi' },
  { key: 'DUPLICATE', label: 'Trùng' },
  { key: 'INVALID', label: 'Lỗi' },
  { key: 'DISPATCHED', label: 'Đang/đã gọi' },
  { key: 'DONE', label: 'Hoàn tất' },
];
const PAGE_SIZE = 10;

/** Nhãn tiếng Việt — khớp nhãn BE dùng trong file export để user không thấy 2 cách gọi. */
const ROW_STATUS_LABELS: Record<string, string> = {
  STAGED: 'Chờ gọi', DUPLICATE: 'Trùng', INVALID: 'Lỗi dữ liệu',
  QUEUED: 'Đang vào hàng đợi', DISPATCHED: 'Đã gửi lệnh gọi', DONE: 'Đã xong', REMOVED: 'Đã xoá',
};
const CALL_RESULT_LABELS: Record<string, string> = {
  ANSWERED: 'Nghe máy', NO_ANSWER: 'Không nghe', FAILED: 'Lỗi', CANCELED: 'Đã huỷ',
};
const EDITABLE = new Set(['STAGED', 'DUPLICATE', 'INVALID']);

export function SessionDataTable({
  rows, scriptName, onDelete, onEditRow, onRestoreDuplicate,
}: {
  rows: DataRow[];
  scriptName?: string;
  onDelete?: (rowIds: string[]) => Promise<void>;
  /** Sửa SĐT 1 dòng — BE tự kiểm tra lại hợp lệ + tính lại trùng cho dòng đó (B7). */
  onEditRow?: (rowId: string, phoneNumber: string) => Promise<void>;
  /** Ép dòng trùng về hàng đợi gọi — user chấp nhận gọi cả hai (B7). */
  onRestoreDuplicate?: (rowId: string) => Promise<void>;
}) {
  const [statusTab, setStatusTab] = useState('ALL');
  const [source, setSource] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ rowId: string; phone: string } | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const hasActions = Boolean(onDelete || onEditRow || onRestoreDuplicate);

  async function run(rowId: string, task: () => Promise<void>) {
    setBusyRow(rowId);
    try {
      await task();
      setEditing(null);
    } finally {
      setBusyRow(null);
    }
  }

  const filtered = useMemo(() => rows
    .filter((r) => r.rowStatus !== 'REMOVED')
    .filter((r) => statusTab === 'ALL'
      || (statusTab === 'DISPATCHED' ? (r.rowStatus === 'DISPATCHED' || r.rowStatus === 'QUEUED') : r.rowStatus === statusTab))
    .filter((r) => source === 'ALL' || r.source === source)
    .filter((r) => !search
      || r.phoneNumber.includes(search)
      || (r.variables?.full_name ?? '').toLowerCase().includes(search.toLowerCase())),
  [rows, statusTab, source, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const countBy = (key: string) => rows.filter((r) =>
    key === 'ALL' ? r.rowStatus !== 'REMOVED'
      : key === 'DISPATCHED' ? (r.rowStatus === 'DISPATCHED' || r.rowStatus === 'QUEUED') : r.rowStatus === key).length;

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-(--color-field) px-4 py-2.5">
        <span className="text-(--color-muted)">⚗️</span>
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => { setStatusTab(t.key); setPage(1); }}
            className={`rounded-full px-3 py-1 text-[13px] font-medium ${
              statusTab === t.key ? 'bg-(--color-navy) text-white' : 'hover:bg-gray-200'}`}>
            {t.label} ({countBy(t.key)})
          </button>
        ))}
        <select className="ml-auto rounded-lg border border-(--color-line) bg-white px-2 py-1.5 text-sm"
          value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
          <option value="ALL">Hình thức: tất cả</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-full bg-(--color-field) px-4 py-2">
        <span>🔍</span>
        <input className="w-full bg-transparent text-sm outline-none"
          placeholder={`Tìm kiếm | ${filtered.length} khách hàng`}
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--color-line) text-left text-(--color-muted)">
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Tên đầy đủ</th>
              <th className="px-3 py-2 font-semibold">Số điện thoại</th>
              <th className="px-3 py-2 font-semibold">Hình thức</th>
              <th className="px-3 py-2 font-semibold">Trạng thái</th>
              <th className="px-3 py-2 font-semibold">Kết quả gọi</th>
              {scriptName && <th className="px-3 py-2 font-semibold">Tên kịch bản</th>}
              <th className="px-3 py-2 font-semibold">Danh sách biến</th>
              {hasActions && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={row.rowId} className="border-b border-(--color-line) last:border-0 hover:bg-gray-50">
                <td className="px-3 py-2.5 text-(--color-muted)">{(current - 1) * PAGE_SIZE + i + 1}</td>
                <td className="px-3 py-2.5">
                  <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-pink-100 align-middle">👤</span>
                  {row.variables?.full_name ?? 'Không xác định'}
                </td>
                <td className="px-3 py-2.5">
                  {editing?.rowId === row.rowId ? (
                    <input autoFocus className="w-36 rounded-lg border border-(--color-primary) px-2 py-1 text-sm outline-none"
                      value={editing.phone}
                      onChange={(e) => setEditing({ rowId: row.rowId, phone: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && onEditRow) void run(row.rowId, () => onEditRow(row.rowId, editing.phone));
                        if (e.key === 'Escape') setEditing(null);
                      }} />
                  ) : row.phoneNumber}
                </td>
                <td className="px-3 py-2.5">{SOURCE_LABELS[row.source] ?? row.source}</td>
                <td className="px-3 py-2.5">
                  <span className={`rowstatus ${row.rowStatus}`}>{ROW_STATUS_LABELS[row.rowStatus] ?? row.rowStatus}</span>
                  {row.invalidReason && <div className="mt-0.5 text-xs text-(--color-danger)">{row.invalidReason}</div>}
                </td>
                <td className="px-3 py-2.5">{row.callResult ? CALL_RESULT_LABELS[row.callResult] ?? row.callResult : '—'}</td>
                {scriptName && <td className="px-3 py-2.5 text-(--color-link)">{scriptName}</td>}
                <td className="max-w-56 truncate px-3 py-2.5 text-xs text-(--color-muted)">
                  {Object.entries(row.variables ?? {}).filter(([k]) => !k.startsWith('__'))
                    .map(([k, v]) => `${k}=${v}`).join('; ') || '—'}
                </td>
                {hasActions && (
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    {/* Dòng đã vào hàng đợi gọi thì BE chặn sửa/xoá — ẩn nút để user không bấm rồi ăn lỗi */}
                    {EDITABLE.has(row.rowStatus) ? (
                      <span className="inline-flex items-center gap-2">
                        {busyRow === row.rowId && <span className="text-xs text-(--color-muted)">…</span>}
                        {onEditRow && (editing?.rowId === row.rowId ? (
                          <>
                            <button className="text-(--color-primary-dark) hover:opacity-70" title="Lưu"
                              onClick={() => void run(row.rowId, () => onEditRow(row.rowId, editing.phone))}>✓</button>
                            <button className="text-(--color-muted) hover:opacity-70" title="Bỏ"
                              onClick={() => setEditing(null)}>↺</button>
                          </>
                        ) : (
                          <button className="text-(--color-link) hover:opacity-70" title="Sửa số điện thoại"
                            onClick={() => setEditing({ rowId: row.rowId, phone: row.phoneNumber })}>✎</button>
                        ))}
                        {onRestoreDuplicate && row.rowStatus === 'DUPLICATE' && (
                          <button className="text-xs text-(--color-link) hover:opacity-70"
                            title="Vẫn gọi dòng này (chấp nhận trùng)"
                            onClick={() => void run(row.rowId, () => onRestoreDuplicate(row.rowId))}>Vẫn gọi</button>
                        )}
                        {onDelete && (
                          <button className="text-(--color-danger) hover:opacity-70" title="Xoá dòng"
                            onClick={() => void run(row.rowId, () => onDelete([row.rowId]))}>✕</button>
                        )}
                      </span>
                    ) : <span className="text-xs text-(--color-muted)">—</span>}
                  </td>
                )}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-(--color-muted)">Chưa có dữ liệu — thêm khách hàng ở khu &quot;Hình thức thêm khách hàng&quot;.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between text-sm text-(--color-muted)">
        <div className="flex items-center gap-1">
          <Button onClick={() => setPage(Math.max(1, current - 1))} disabled={current <= 1}>‹</Button>
          <span className="rounded-lg bg-(--color-navy) px-3 py-1.5 font-semibold text-white">{current}</span>
          <Button onClick={() => setPage(Math.min(totalPages, current + 1))} disabled={current >= totalPages}>›</Button>
        </div>
        <span>{filtered.length === 0 ? '0' : `${(current - 1) * PAGE_SIZE + 1} - ${Math.min(current * PAGE_SIZE, filtered.length)}`} của {filtered.length} · {PAGE_SIZE} dòng/trang</span>
      </div>
    </div>
  );
}
