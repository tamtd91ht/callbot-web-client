'use client';
/** Bảng data phiên (template img_3): filter Hình thức + tab trạng thái + search + pagination. */
import { useEffect, useMemo, useState } from 'react';
import type { DataRow, SessionCounters } from '@/contracts/types';
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
  rows, scriptName, totalRows, counters, filter, onFilterChange,
  hasMore, loadingMore, onLoadMore,
  onDelete, onEditRow, onRestoreDuplicate,
}: {
  rows: DataRow[];
  scriptName?: string;
  /**
   * Tổng số dòng THẬT của phiên (từ counters realtime) — dùng để phát hiện bảng đang bị cắt.
   * Không truyền thì không cảnh báo được, người dùng sẽ tự hiểu nhầm rows.length là tổng.
   */
  totalRows?: number;
  /**
   * Số liệu TOÀN PHIÊN (từ counters realtime) — nguồn đếm cho các tab trạng thái.
   * Không truyền thì rơi về đếm trên tập đã tải (đúng khi phiên nhỏ, sai khi phiên lớn).
   */
  counters?: Partial<SessionCounters>;
  /**
   * Bộ lọc hiện tại — do trang sở hữu vì việc lọc chạy trên BE (cùng chủ với cursor).
   * Không truyền = chế độ cũ: bảng tự giữ filter và lọc trên tập đã tải.
   */
  filter?: { statusTab: string; source: string; search: string };
  onFilterChange?: (next: { statusTab: string; source: string; search: string }) => void;
  /** Còn trang data chưa tải (cursor chưa cạn). */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
  onDelete?: (rowIds: string[]) => Promise<void>;
  /** Sửa SĐT 1 dòng — BE tự kiểm tra lại hợp lệ + tính lại trùng cho dòng đó (B7). */
  onEditRow?: (rowId: string, phoneNumber: string) => Promise<void>;
  /** Ép dòng trùng về hàng đợi gọi — user chấp nhận gọi cả hai (B7). */
  onRestoreDuplicate?: (rowId: string) => Promise<void>;
}) {
  const [localFilter, setLocalFilter] = useState({ statusTab: 'ALL', source: 'ALL', search: '' });
  // Controlled khi trang truyền filter xuống (lọc chạy trên BE); ngược lại giữ nguyên hành vi cũ.
  const serverFiltered = filter != null && onFilterChange != null;
  const { statusTab, source, search } = filter ?? localFilter;
  const setFilter = (next: { statusTab: string; source: string; search: string }) => {
    setPage(1);
    if (serverFiltered) onFilterChange!(next);
    else setLocalFilter(next);
  };

  /**
   * Ô tìm kiếm: hiện ngay chữ vừa gõ, nhưng chỉ gọi BE sau khi ngừng gõ.
   *
   * ⚠️ Không debounce thì mỗi phím là một query ES trên cluster dùng chung — gõ "0912345678" là 10
   * query, nhân với số người đang mở màn hình. Tab và bộ lọc nguồn thì gọi ngay vì đó là một cú
   * bấm dứt khoát, không phải chuỗi thao tác.
   */
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => { setSearchDraft(search); }, [search]);
  useEffect(() => {
    if (!serverFiltered || searchDraft === search) return;
    const timer = setTimeout(() => setFilter({ statusTab, source, search: searchDraft }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft, serverFiltered]);
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

  // ⚠️ Khi BE đã lọc thì KHÔNG lọc lại ở client: ngữ nghĩa hai bên không giống hệt nhau (BE tìm tên
  // theo PREFIX qua matchPhrasePrefix, client trước đây dùng "contains"), lọc chồng sẽ ăn mất dòng
  // BE trả về hợp lệ — người dùng thấy "không có kết quả" trong khi dữ liệu có thật.
  const filtered = useMemo(() => {
    if (serverFiltered) return rows;
    return rows
      .filter((r) => r.rowStatus !== 'REMOVED')
      .filter((r) => statusTab === 'ALL'
        || (statusTab === 'DISPATCHED' ? (r.rowStatus === 'DISPATCHED' || r.rowStatus === 'QUEUED') : r.rowStatus === statusTab))
      .filter((r) => source === 'ALL' || r.source === source)
      .filter((r) => !search
        || r.phoneNumber.includes(search)
        || (r.variables?.full_name ?? '').toLowerCase().includes(search.toLowerCase()));
  }, [rows, statusTab, source, search, serverFiltered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  /**
   * Đếm cho tab trạng thái — ưu tiên counters TOÀN PHIÊN.
   *
   * ⚠️ Trước đây luôn đếm trên `rows` (tập ĐÃ TẢI), nên phiên vài chục nghìn dòng hiện
   * "Chờ gọi (200)" trong khi thực tế còn hàng chục nghìn — con số sai mà nhìn như đúng.
   * Nay lấy từ counters (BE aggregate theo rowStatus trên toàn phiên).
   *
   * Fallback về đếm cục bộ khi chưa có counters (phiên DRAFT chưa submit — chưa có snapshot nào,
   * và lúc đó toàn bộ dòng đều đã tải nên đếm cục bộ CHÍNH XÁC).
   */
  const countBy = (key: string) => {
    if (counters) {
      switch (key) {
        // ALL không tính REMOVED — khớp bộ lọc bên dưới. counters.total đã loại REMOVED ở BE.
        case 'ALL': return counters.total ?? 0;
        case 'STAGED': return counters.staged ?? 0;
        case 'DUPLICATE': return counters.duplicated ?? 0;
        case 'INVALID': return counters.invalid ?? 0;
        // Tab "Đang/đã gọi" gộp QUEUED + DISPATCHED (đang trong pipeline), KHÔNG gồm DONE.
        case 'DISPATCHED': return (counters.queued ?? 0) + (counters.dispatched ?? 0);
        case 'DONE': return counters.done ?? 0;
        default: return 0;
      }
    }
    return rows.filter((r) =>
      key === 'ALL' ? r.rowStatus !== 'REMOVED'
        : key === 'DISPATCHED' ? (r.rowStatus === 'DISPATCHED' || r.rowStatus === 'QUEUED') : r.rowStatus === key).length;
  };

  // Số trên tab là của TOÀN PHIÊN, còn bảng chỉ liệt kê phần đã tải — hai con số này lệch nhau là
  // BÌNH THƯỜNG nhưng phải nói ra, nếu không lại đổi một hiểu nhầm này lấy một hiểu nhầm khác
  // ("tab bảo 50.000 mà bảng chỉ có 200 dòng").
  const truncatedCount = countBy(statusTab);
  const filteredIsPartial = counters != null && truncatedCount > filtered.length;

  // Còn dòng chưa tải: nói rõ đang xem bao nhiêu trên tổng, và cho cách xem tiếp.
  // Trước đây bảng bị cắt cứng ở 200 dòng (BE chưa đọc cursor) nên chỉ báo được "không xem hết
  // được"; nay đã tải tiếp được nên câu chữ đổi theo — đừng để lại lời cảnh báo cũ, nó sai.
  const truncated = typeof totalRows === 'number' && totalRows > rows.length;

  return (
    <div>
      {!truncated && filteredIsPartial && (
        <div className="mb-3 rounded-xl bg-(--color-field) px-4 py-2 text-[13px] text-(--color-muted)">
          Số trên tab là của cả phiên ({truncatedCount.toLocaleString('vi-VN')}); bảng dưới đang liệt
          kê {filtered.length.toLocaleString('vi-VN')} dòng đã tải.
        </div>
      )}
      {truncated && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <span>
            Đang hiển thị <b>{rows.length.toLocaleString('vi-VN')}</b> / {totalRows!.toLocaleString('vi-VN')} dòng.
            Phần chưa hiện <b>vẫn được gọi bình thường</b>.
          </span>
          {hasMore && onLoadMore && (
            <button type="button" disabled={loadingMore} onClick={() => void onLoadMore()}
              className="ml-auto rounded-lg bg-(--color-navy) px-3 py-1 text-white disabled:opacity-60">
              {loadingMore ? 'Đang tải…' : 'Tải thêm'}
            </button>
          )}
        </div>
      )}
      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-(--color-field) px-4 py-2.5">
        <span className="text-(--color-muted)">⚗️</span>
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => setFilter({ statusTab: t.key, source, search })}
            className={`rounded-full px-3 py-1 text-[13px] font-medium ${
              statusTab === t.key ? 'bg-(--color-navy) text-white' : 'hover:bg-gray-200'}`}>
            {t.label} ({countBy(t.key)})
          </button>
        ))}
        <select className="ml-auto rounded-lg border border-(--color-line) bg-white px-2 py-1.5 text-sm"
          value={source} onChange={(e) => setFilter({ statusTab, source: e.target.value, search })}>
          <option value="ALL">Hình thức: tất cả</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-full bg-(--color-field) px-4 py-2">
        <span>🔍</span>
        <input className="w-full bg-transparent text-sm outline-none"
          placeholder="Tìm theo số điện thoại hoặc tên"
          value={serverFiltered ? searchDraft : search}
          onChange={(e) => (serverFiltered
            ? setSearchDraft(e.target.value)
            : setFilter({ statusTab, source, search: e.target.value }))} />
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
