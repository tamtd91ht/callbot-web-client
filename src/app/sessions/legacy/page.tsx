'use client';
/**
 * Quản lý phiên LUỒNG CŨ (CallBotHandler) — tách hẳn khỏi /sessions của luồng Client Session.
 *
 * VÌ SAO TÁCH TRANG RIÊNG: hai luồng có ngữ nghĩa khác nhau, gộp chung thì không phân biệt được.
 *   - Trạng thái gốc luồng cũ chỉ có 4: PROCESSING / PAUSING / CANCELED / DONE. Màn /sessions
 *     map cưỡng bức sang 6 trạng thái của luồng mới (DRAFT/SCHEDULED/... ) nên lọc ở đó sai nghĩa.
 *   - Phiên luồng cũ KHÔNG tạo/sửa được từ app này, chỉ xem + tạm dừng/tiếp tục/huỷ.
 *
 * LỌC CHẠY PHÍA SERVER — khác hẳn /sessions. `CallBotSessionFilter` thật sự đọc status/keyword,
 * và `/session/search` trả `total_items` nên phân trang được. Không phải tải 50 rồi lọc ở client.
 *
 * ⚠️ CỬA SỔ THỜI GIAN LÀ BẮT BUỘC và là cái bẫy lớn nhất ở đây: BE lọc range trên `sessionTimeMs`
 * (thời điểm PHIÊN, không phải thời điểm cuộc gọi), `fromDate >= toDate` là lỗi kể cả khi bằng
 * nhau, và `toDate` tương lai bị kẹp về now TRƯỚC khi so sánh. Chọn sai khoảng thì trả 0 phiên
 * mà không có lỗi nào.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClientSession, LegacySessionReport, LegacySessionStatus,
} from '@/contracts/types';
import { ApiError } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { Button, Card } from '@/components/ui';

const PAGE_SIZE = 20;

/** BE chỉ áp dụng keyword khi dài HƠN 3 ký tự — ngắn hơn là bỏ qua im lặng. */
const MIN_KEYWORD_LENGTH = 4;

const STATUS_FILTERS: Array<{ key: 'ALL' | LegacySessionStatus; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'PROCESSING', label: 'Đang chạy' },
  { key: 'PAUSING', label: 'Tạm dừng' },
  { key: 'DONE', label: 'Hoàn tất' },
  { key: 'CANCELED', label: 'Đã huỷ' },
];

/** Khoảng thời gian dựng sẵn — tính theo NGÀY để tránh lệch múi giờ khi so bằng mốc ms. */
const RANGES: Array<{ key: string; label: string; days: number }> = [
  { key: '7d', label: '7 ngày', days: 7 },
  { key: '30d', label: '30 ngày', days: 30 },
  { key: '90d', label: '90 ngày', days: 90 },
  { key: '365d', label: '1 năm', days: 365 },
];

export default function LegacySessionsPage() {
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [total, setTotal] = useState(0);
  const [report, setReport] = useState<LegacySessionReport | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'ALL' | LegacySessionStatus>('ALL');
  const [rangeKey, setRangeKey] = useState('30d');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Mốc lọc. `toDate` lấy now + 1 phút phòng lệch đồng hồ — BE tự kẹp về now nên không rủi ro,
   * nhưng tránh được ca `fromDate === toDate` khi khoảng bằng 0.
   */
  const { fromDate, toDate } = useMemo(() => {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 30;
    const now = Date.now();
    return { fromDate: now - days * 24 * 60 * 60 * 1000, toDate: now + 60_000 };
  }, [rangeKey]);

  // Keyword ngắn KHÔNG gửi lên: BE bỏ qua im lặng, gửi đi chỉ khiến người dùng tưởng đã lọc.
  const effectiveKeyword = appliedKeyword.length >= MIN_KEYWORD_LENGTH ? appliedKeyword : undefined;

  const baseFilter = useMemo(() => ({
    fromDate,
    toDate,
    status: status === 'ALL' ? undefined : [status],
    keyword: effectiveKeyword,
  }), [fromDate, toDate, status, effectiveKeyword]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await sessionApi.legacyList({ ...baseFilter, page, size: PAGE_SIZE });
      setSessions(result.items);
      setTotal(result.total);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setSessions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [baseFilter, page]);

  /** Báo cáo tổng hợp — cùng bộ lọc, KHÔNG phụ thuộc trang. */
  const loadReport = useCallback(async () => {
    try {
      setReport(await sessionApi.legacyReport(baseFilter));
    } catch {
      // Lỗi báo cáo không che danh sách.
      setReport(null);
    }
  }, [baseFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadReport(); }, [loadReport]);

  // Đổi bộ lọc thì về trang 1, nếu không sẽ rơi vào trang trống.
  useEffect(() => { setPage(1); }, [status, rangeKey, appliedKeyword]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const keywordTooShort = appliedKeyword.length > 0 && appliedKeyword.length < MIN_KEYWORD_LENGTH;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Phiên luồng cũ (CallBotHandler)</h1>
          <p className="mt-1 text-xs text-(--color-muted)">
            Phiên tạo từ Omiflow/API. Xem và điều khiển được, nhưng <b>không tạo/sửa</b> từ app này.
          </p>
          <div className="mt-1 h-1 w-8 rounded bg-(--color-primary)" />
        </div>
        <Link href="/sessions">
          <Button>← Phiên luồng mới</Button>
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Báo cáo tổng hợp — mẫu số là CUỘC GỌI, khác báo cáo khách hàng ở màn chi tiết. */}
      {report && report.totalSession > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Tile label="Phiên" value={report.totalSession} />
          <Tile label="Tổng cuộc gọi" value={report.totalRecord} />
          <Tile label="Nghe máy" value={report.totalAnswered} highlight
            hint={report.totalRecord > 0
              ? `${((report.totalAnswered / report.totalRecord) * 100).toFixed(2)}% · trên CUỘC`
              : undefined} />
          <Tile label="Không nghe" value={report.totalNoAnswer} />
          <Tile label="Lỗi" value={report.totalFailed} />
          <Tile label="Đang gọi" value={report.totalProcessing} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setStatus(f.key)}
              className={`rounded-full px-3.5 py-1 text-[13px] font-medium transition ${
                status === f.key
                  ? 'bg-(--color-navy) text-white'
                  : 'bg-(--color-field) text-(--color-ink) hover:bg-gray-200'}`}>
              {f.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px self-center bg-(--color-line)" />
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRangeKey(r.key)}
              className={`rounded-full px-3.5 py-1 text-[13px] font-medium transition ${
                rangeKey === r.key
                  ? 'bg-(--color-navy) text-white'
                  : 'bg-(--color-field) text-(--color-ink) hover:bg-gray-200'}`}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setAppliedKeyword(keyword.trim()); }}
            placeholder="Tìm theo tên phiên…"
            className="w-52 rounded-(--radius-field) border border-(--color-line) px-3 py-1.5 text-sm outline-none focus:border-(--color-primary)" />
          <Button onClick={() => setAppliedKeyword(keyword.trim())}>Tìm</Button>
          <Button onClick={() => { void load(); void loadReport(); }}>Làm mới</Button>
        </div>
      </div>

      {keywordTooShort && (
        <div className="mb-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Từ khoá phải từ {MIN_KEYWORD_LENGTH} ký tự trở lên — backend bỏ qua từ khoá ngắn hơn,
          nên kết quả dưới đây <b>chưa lọc theo tên</b>.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-200 text-sm">
          <thead className="bg-(--color-field) text-left text-xs text-(--color-muted)">
            <tr>
              <Th className="w-12">#</Th>
              <Th>Tên phiên</Th>
              <Th>Trạng thái</Th>
              <Th>Nguồn</Th>
              <Th className="text-right">Tổng KH</Th>
              <Th className="text-right">Nghe máy</Th>
              <Th className="text-right">Còn lại</Th>
              <Th>Bắt đầu</Th>
              <Th className="w-20"> </Th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, index) => {
              const c = s.counters;
              return (
                <tr key={s.id} className="border-t border-(--color-line)">
                  <Td className="text-(--color-muted)">{(page - 1) * PAGE_SIZE + index + 1}</Td>
                  <Td className="font-medium">{s.name}</Td>
                  <Td><StatusBadge status={s.status} /></Td>
                  <Td className="text-(--color-muted)">{s.purpose ?? '—'}</Td>
                  <Td className="text-right">{(c?.total ?? 0).toLocaleString('vi-VN')}</Td>
                  <Td className="text-right">{(c?.answered ?? 0).toLocaleString('vi-VN')}</Td>
                  <Td className="text-right">{(c?.remaining ?? 0).toLocaleString('vi-VN')}</Td>
                  <Td className="text-(--color-muted)">{formatTime(s.startTimeMs)}</Td>
                  <Td>
                    <Link href={`/sessions/${encodeURIComponent(s.id)}`}
                      className="text-(--color-link) hover:underline">
                      Chi tiết
                    </Link>
                  </Td>
                </tr>
              );
            })}
            {sessions.length === 0 && !loading && (
              <tr><td colSpan={9} className="py-6 text-center text-sm text-(--color-muted)">
                Không có phiên nào trong khoảng thời gian đã chọn
              </td></tr>
            )}
            {loading && sessions.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-sm text-(--color-muted)">Đang tải…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-(--color-muted)">
          {total.toLocaleString('vi-VN')} phiên
          {loading && sessions.length > 0 && ' · đang cập nhật…'}
        </span>
        <div className="flex items-center gap-2">
          <Button disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Trước
          </Button>
          <span className="text-(--color-muted)">Trang {page}/{pageCount}</span>
          <Button disabled={page >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>
            Sau
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Nhãn theo trạng thái ĐÃ MAP sang dạng luồng mới (mapOldSession) — 4 giá trị gốc gộp lại. */
function StatusBadge({ status }: { status: ClientSession['status'] }) {
  const style: Record<string, { label: string; className: string }> = {
    RUNNING: { label: 'Đang chạy', className: 'bg-sky-50 text-sky-700' },
    PAUSED: { label: 'Tạm dừng', className: 'bg-amber-50 text-amber-800' },
    COMPLETED: { label: 'Hoàn tất', className: 'bg-(--color-primary-soft) text-(--color-primary-dark)' },
    CANCELED: { label: 'Đã huỷ', className: 'bg-gray-100 text-gray-600' },
  };
  const s = style[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.className}`}>
      {s.label}
    </span>
  );
}

function Tile({ label, value, hint, highlight }: {
  label: string; value: number; hint?: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 ${highlight
      ? 'border-(--color-primary) bg-(--color-primary-soft)'
      : 'border-(--color-line)'}`}>
      <div className="text-xs text-(--color-muted)">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${highlight ? 'text-(--color-primary-dark)' : ''}`}>
        {value.toLocaleString('vi-VN')}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-(--color-muted)">{hint}</div>}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function formatTime(ms?: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
