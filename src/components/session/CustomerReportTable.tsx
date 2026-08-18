'use client';
/**
 * Báo cáo khách hàng của một phiên (A-05) — đọc index gom, MỘT KH = MỘT DÒNG.
 *
 * PHÂN BIỆT VỚI HAI BẢNG KIA (người vận hành rất hay lẫn, nên ghi rõ trên UI luôn):
 *   - SessionDataTable  = DATA STAGING: khách đã nạp vào phiên, có trạng thái trùng/lỗi.
 *   - CallHistoryTable  = CUỘC GỌI: khách bị gọi lại 3 lần → 3 dòng.
 *   - bảng này          = KHÁCH HÀNG: gọi lại bao nhiêu lần vẫn 1 dòng, cột "Kết quả" lấy
 *                         kết quả TỐT NHẤT của mọi lần gọi.
 *
 * ⚠️ VÌ VẬY TỈ LỆ NGHE MÁY Ở ĐÂY KHÁC Ô "Tỉ lệ nghe máy" CỦA BÁO CÁO PHIÊN, CẢ HAI ĐỀU ĐÚNG:
 * ở đây mẫu số là KHÁCH, bên kia là CUỘC. Khách gọi 3 lần, lần cuối mới nghe máy → ở đây
 * 1/1 = 100%, báo cáo phiên 1/3 = 33%. Không ghi nhãn thì chắc chắn bị báo "lỗi số liệu".
 *
 * PHÂN TRANG LÀ CURSOR (search_after), KHÔNG phải số trang. BE trả response theo khuôn phân
 * trang chuẩn của hệ (Paginated: total_items/page_number/total_pages/has_next…) nhưng đó chỉ là
 * NHÃN HIỂN THỊ — không nhảy tới trang bất kỳ được, vì ES chặn from/size sâu ở 10.000 doc.
 * Nên vẫn chỉ đi tiến/lùi tuần tự: muốn lùi phải tự nhớ cursor các trang đã qua (stack bên
 * dưới), và số trang gửi lên BE được truyền kèm để BE dựng đúng nhãn.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClientSession, CustomerReportRow, CustomerReportSortField, CustomerReportSummary,
  CustomerReportTatBucket,
} from '@/contracts/types';
import { ApiError } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { parseCompositeId } from '@/contracts/mappers';
import { Button } from '../ui';
import { CustomerReportDetailDrawer } from './CustomerReportDetailDrawer';

const PAGE_SIZE = 20;

/** Ngưỡng TAT mặc định (ngày lịch). BE cũng mặc định 3 và kẹp về [1, 365]. */
const DEFAULT_TAT_DAYS = 3;
const MAX_TAT_DAYS = 365;

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'ANSWERED', label: 'Nghe máy' },
  { key: 'NO_ANSWER', label: 'Không nghe' },
  { key: 'FAILED', label: 'Lỗi' },
  { key: 'CANCELED', label: 'Đã huỷ' },
  { key: 'PROCESSING', label: 'Đang gọi' },
];

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  ANSWERED: { label: 'Nghe máy', className: 'bg-(--color-primary-soft) text-(--color-primary-dark)' },
  NO_ANSWER: { label: 'Không nghe', className: 'bg-amber-50 text-amber-800' },
  FAILED: { label: 'Lỗi', className: 'bg-red-50 text-red-700' },
  PROCESSING: { label: 'Đang gọi', className: 'bg-sky-50 text-sky-700' },
  CANCELED: { label: 'Đã huỷ', className: 'bg-gray-100 text-gray-600' },
};

/** Cột sort được — đúng whitelist BE; ngoài danh sách này BE lặng lẽ rơi về lastCallTimeMs. */
const SORT_COLUMNS: Array<{ field: CustomerReportSortField; label: string }> = [
  { field: 'lastCallTimeMs', label: 'Gọi lần cuối' },
  { field: 'firstCallTimeMs', label: 'Gọi lần đầu' },
  { field: 'totalCall', label: 'Số cuộc' },
  { field: 'totalAnswered', label: 'Nghe máy' },
  { field: 'totalBillSec', label: 'Thời lượng gọi' },
  { field: 'totalAnswerSec', label: 'Thời lượng kết nối' },
];

type ContactFilter = 'ALL' | 'HAS' | 'NONE';

export function CustomerReportTable({
  session, refreshKey,
}: { session: ClientSession; refreshKey?: number }) {
  const [rows, setRows] = useState<CustomerReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string[] | null>(null);
  /** Cursor của các trang ĐÃ qua — phần tử cuối là cursor mở trang hiện tại. */
  const [cursorStack, setCursorStack] = useState<Array<string[] | null>>([null]);
  const [status, setStatus] = useState('ALL');
  const [contactFilter, setContactFilter] = useState<ContactFilter>('ALL');
  const [minCalls, setMinCalls] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [sortField, setSortField] = useState<CustomerReportSortField>('lastCallTimeMs');
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomerReportRow | null>(null);
  const [summary, setSummary] = useState<CustomerReportSummary | null>(null);
  /** true = endpoint tổng hợp trả 404 → service chưa deploy bản mới, không phải hết dữ liệu. */
  const [summaryMissing, setSummaryMissing] = useState(false);
  /**
   * Ngưỡng TAT (ngày lịch) — bộ lọc, không phải hằng số: đổi là hai ô TAT tính lại.
   * Mặc định 3 để khớp mục tiêu nghiệp vụ hiện tại.
   */
  const [tatDays, setTatDays] = useState(DEFAULT_TAT_DAYS);

  // Phiên luồng cũ mang id ghép "sessionId~sessionTimeMs" — tách ra lấy đúng 2 tham số BE cần.
  const legacy = useMemo(() => parseCompositeId(session.id), [session.id]);

  /**
   * ⚠️ Báo cáo KH khoá theo PHIÊN RUNTIME, không phải theo ClientSession trên Mongo.
   *
   * Dòng gom lưu `sessionId` = runtimeSessionId và `sessionTimeMs` = runtimeSessionTimeMs (mốc sinh
   * lúc SUBMIT). Trước đây chỗ này gửi `session.id` (id Mongo) và neo cửa sổ bằng
   * startTimeMs/createdTimeMs của ClientSession — CẢ HAI đều sai với phiên luồng mới, nên bảng
   * TRẢ RỖNG mà không một dòng lỗi (và hai ô TAT trắng theo).
   *
   * Luồng cũ không có runtime* (chính nó là phiên runtime) nên rơi về id ghép.
   */
  const sessionId = session.runtimeSessionId || legacy.sessionId;
  const sessionTimeMs = session.runtimeSessionTimeMs || legacy.sessionTimeMs;

  /**
   * Mốc neo cửa sổ thời gian = mốc PHIÊN RUNTIME, vì BE chọn index ES từ chính giá trị này
   * (ElasticIndexManagement: session/record/customer-report đều neo vào sessionTimeMs).
   * KHÔNG lấy Date.now() và KHÔNG lấy mốc Mongo — phiên chạy vắt qua giao năm sẽ tra sai index
   * rồi trả rỗng mà không có lỗi nào.
   */
  const anchorMs = sessionTimeMs || 0;

  const load = useCallback(async (cursor: string[] | null, pageNumber = 1) => {
    // Thiếu mốc phiên = BE không suy được tên index (mốc 0 → index năm 1970) → TRẢ RỖNG, KHÔNG
    // LỖI, KHÔNG LOG, nhìn y hệt "phiên chưa gọi ai". Chặn tại đây và báo thẳng.
    // Phiên chưa submit thì runtimeSessionTimeMs còn null — đó là trường hợp bình thường.
    if (!anchorMs) {
      setRows([]); setTotal(0); setNextCursor(null);
      setError('Phiên chưa chạy nên chưa có báo cáo khách hàng.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await sessionApi.customerReport({
        sessionId,
        sessionTimeMs: anchorMs,
        bestStatuses: status === 'ALL' ? undefined : [status],
        hasContact: contactFilter === 'ALL' ? undefined : contactFilter === 'HAS',
        keyword: appliedKeyword || undefined,
        minCalls: minCalls > 0 ? minCalls : undefined,
        size: PAGE_SIZE,
        cursor: cursor ?? undefined,
        // Số trang chỉ để BE dựng nhãn phân trang; đi tiếp vẫn bằng cursor ở trên.
        // Truyền qua THAM SỐ chứ không đọc cursorStack: cursorStack không nằm trong deps của
        // useCallback này, đọc trong closure sẽ dính giá trị cũ (và thêm vào deps thì mỗi lần
        // đổi trang lại tạo hàm mới, kéo theo load thừa).
        page: pageNumber,
        sortField,
        sortAsc,
      });
      setRows(result.data);
      setTotal(result.total);
      setNextCursor(result.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setRows([]);
      setTotal(0);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [anchorMs, sessionId, status, contactFilter, appliedKeyword, minCalls, sortField, sortAsc]);

  /**
   * Ô tổng hợp — CÙNG bộ lọc với danh sách (BE dùng chung hàm dựng query) nên số luôn khớp.
   * KHÔNG phụ thuộc cursor/sort: đổi trang hay đổi cột sắp xếp thì tổng hợp không đổi,
   * gọi lại chỉ tốn thêm một vòng request.
   */
  const loadSummary = useCallback(async () => {
    if (!anchorMs) { setSummary(null); return; }
    try {
      setSummary(await sessionApi.customerReportSummary({
        sessionId,
        sessionTimeMs: anchorMs,
        bestStatuses: status === 'ALL' ? undefined : [status],
        hasContact: contactFilter === 'ALL' ? undefined : contactFilter === 'HAS',
        keyword: appliedKeyword || undefined,
        minCalls: minCalls > 0 ? minCalls : undefined,
        tatDays,
      }));
      setSummaryMissing(false);
    } catch (e) {
      // Lỗi tổng hợp KHÔNG che bảng: danh sách vẫn dùng được, chỉ ẩn dải ô.
      setSummary(null);
      // 404 = service chưa deploy bản có /report/customer/summary (route ĐÃ có trong code BE).
      // Phân biệt với "không có dữ liệu", nếu không sẽ mất thời gian nghi ngờ nhầm chỗ.
      setSummaryMissing(e instanceof ApiError && e.errorCode === 'CS_BAD_GATEWAY');
    }
    // tatDays nằm trong dep -> đổi ngưỡng là tự gọi lại ô tổng hợp (danh sách KHÔNG đổi nên
    // load() cố ý không phụ thuộc field này).
  }, [anchorMs, sessionId, status, contactFilter, appliedKeyword, minCalls, tatDays]);

  // Đổi bộ lọc/sort thì cursor cũ VÔ NGHĨA (search_after bám theo giá trị sort) → reset về trang đầu.
  useEffect(() => {
    setCursorStack([null]);
    void load(null, 1);
  }, [load, refreshKey]);

  useEffect(() => { void loadSummary(); }, [loadSummary, refreshKey]);

  const goNext = () => {
    if (!nextCursor) return;
    // cursorStack khoi tao [null] nen length = SO TRANG dang xem; sang trang ke = length + 1.
    setCursorStack((s) => [...s, nextCursor]);
    void load(nextCursor, cursorStack.length + 1);
  };

  const goPrev = () => {
    if (cursorStack.length <= 1) return;
    const stack = cursorStack.slice(0, -1);
    setCursorStack(stack);
    void load(stack[stack.length - 1], stack.length);
  };

  const toggleSort = (field: CustomerReportSortField) => {
    if (field === sortField) setSortAsc((v) => !v);
    else { setSortField(field); setSortAsc(false); }
  };

  const pageIndex = cursorStack.length;
  const notSubmitted = !session.runtimeSessionId && session.status === 'DRAFT';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold">Báo cáo khách hàng</h3>
          <p className="mt-0.5 text-xs text-(--color-muted)">
            Mỗi khách hàng một dòng — gọi lại bao nhiêu lần vẫn gộp chung.
            Cột <b>Kết quả</b> lấy kết quả tốt nhất của mọi lần gọi, nên tỉ lệ nghe máy ở đây
            tính trên số <b>khách</b>, khác ô “Tỉ lệ nghe máy” của báo cáo phiên (tính trên số <b>cuộc</b>).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setAppliedKeyword(keyword.trim()); }}
            placeholder="Tìm số điện thoại hoặc tên…"
            className="w-56 rounded-(--radius-field) border border-(--color-line) px-3 py-1.5 text-sm outline-none focus:border-(--color-primary)" />
          <Button onClick={() => setAppliedKeyword(keyword.trim())}>Tìm</Button>
          <Button onClick={() => { void load(cursorStack[cursorStack.length - 1], cursorStack.length); void loadSummary(); }}>
            Làm mới
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setStatus(f.key)}
            className={`rounded-full px-3.5 py-1 text-[13px] font-medium transition ${
              status === f.key
                ? 'bg-(--color-navy) text-white'
                : 'bg-(--color-field) text-(--color-ink) hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-(--color-line)" />

        {([
          { key: 'ALL', label: 'Mọi khách' },
          { key: 'HAS', label: 'Có trong danh bạ' },
          { key: 'NONE', label: 'Số lạ' },
        ] as Array<{ key: ContactFilter; label: string }>).map((f) => (
          <button key={f.key} type="button" onClick={() => setContactFilter(f.key)}
            className={`rounded-full px-3.5 py-1 text-[13px] font-medium transition ${
              contactFilter === f.key
                ? 'bg-(--color-navy) text-white'
                : 'bg-(--color-field) text-(--color-ink) hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-(--color-line)" />

        <label className="flex items-center gap-1.5 text-[13px] text-(--color-muted)">
          Bị gọi từ
          <input type="number" min={0} value={minCalls || ''} placeholder="0"
            onChange={(e) => setMinCalls(Math.max(0, Number(e.target.value) || 0))}
            className="w-16 rounded-(--radius-field) border border-(--color-line) px-2 py-1 text-sm text-(--color-ink) outline-none focus:border-(--color-primary)" />
          cuộc trở lên
        </label>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</div>}

      {summaryMissing && (
        <div className="mb-3 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Chưa hiện được ô tổng hợp: service stg chưa deploy bản có <code>/report/customer/summary</code>.
          Danh sách bên dưới vẫn là dữ liệu thật.
        </div>
      )}

      {/* Dải ô tổng hợp — CÙNG bộ lọc với bảng nên số luôn khớp. Đổi trang không làm số đổi. */}
      {summary && summary.totalCustomers > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <SummaryTile label="Khách hàng" value={summary.totalCustomers.toLocaleString('vi-VN')} />
          <SummaryTile label="Tỉ lệ nghe máy"
            value={`${summary.answerRateByCustomer.toFixed(2)}%`}
            hint={`${summary.answeredCustomers.toLocaleString('vi-VN')} khách · tính trên KHÁCH`}
            highlight />
          <SummaryTile label="Tổng cuộc gọi" value={summary.totalCall.toLocaleString('vi-VN')}
            hint={summary.totalCall > summary.totalCustomers
              ? `${(summary.totalCall - summary.totalCustomers).toLocaleString('vi-VN')} lần gọi lại`
              : undefined} />
          <SummaryTile label="TB mỗi cuộc" value={formatDuration(summary.avgBillSec)}
            hint="÷ số cuộc" />
          <SummaryTile label="TB kết nối" value={formatDuration(summary.avgAnswerSec)}
            hint="÷ cuộc nghe máy" />
          <SummaryTile label="TB đổ chuông" value={formatMs(summary.avgRingingTimeMs)}
            hint="÷ cuộc đo được" />
        </div>
      )}

      {/*
        Báo cáo TAT — đo độ nhanh tiếp cận khách kể từ lúc khách vào CRM.
        Ẩn hẳn khi BE không trả khối `tat` (chưa deploy, hoặc mapping ES thiếu field nên agg lỗi):
        hiện 0% sẽ bị hiểu là "không ai đạt", sai hẳn nghĩa.
      */}
      {summary && summary.tat && (
        <div className="mb-4 rounded-xl border border-(--color-line) p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">Báo cáo TAT ({tatDays} ngày)</div>
            <label className="flex items-center gap-2 text-xs text-(--color-muted)">
              Ngưỡng TAT
              <input type="number" min={1} max={MAX_TAT_DAYS} value={tatDays}
                onChange={(e) => setTatDays(clampTatDays(e.target.value))}
                className="w-16 rounded-(--radius-field) border border-(--color-line) px-2 py-1 text-center text-sm text-(--color-ink) outline-none focus:border-(--color-primary)" />
              ngày
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <TatCard title="Connect TAT" tatDays={tatDays}
              subtitle="Từ khi vào CRM đến khi kết nối được với KH"
              bucket={summary.tat.connect} tone="amber" />
            <TatCard title="First call TAT" tatDays={tatDays}
              subtitle="Từ khi vào CRM đến cuộc gọi đầu tiên"
              bucket={summary.tat.firstCall} tone="primary" />
          </div>

          <div className="mt-3 rounded-lg bg-(--color-field) px-3 py-2 text-[11px] leading-relaxed text-(--color-muted)">
            <b>Cách tính:</b> <b>Connect</b> = pass nếu thời gian từ lúc khách được tạo trong CRM đến
            khi <b>nghe máy</b> &lt; {tatDays} ngày · <b>First call</b> = pass nếu từ lúc tạo đến
            <b> cuộc gọi đầu tiên</b> &lt; {tatDays} ngày. Ngày lịch thường, không trừ cuối tuần/lễ.
            {' '}Khách <b>chưa bao giờ nghe máy</b> tính là fail.
            {summary.tat.connect.unmeasured > 0 && (
              <>
                {' '}<b className="text-amber-800">
                  {summary.tat.connect.unmeasured.toLocaleString('vi-VN')} khách không đo được
                </b>{' '}
                (không khớp danh bạ CRM, hoặc đã gom trước khi có chỉ tiêu này) — đã loại khỏi mẫu số,
                không tính là fail.
              </>
            )}
          </div>
        </div>
      )}

      {notSubmitted ? (
        <p className="py-6 text-center text-sm text-(--color-muted)">
          Phiên chưa submit nên chưa có khách hàng nào được gọi.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-280 text-sm">
              <thead className="bg-(--color-field) text-left text-xs text-(--color-muted)">
                <tr>
                  <Th className="w-12">#</Th>
                  <Th>Khách hàng</Th>
                  <Th>Kết quả</Th>
                  <Th>Lần gọi cuối</Th>
                  {SORT_COLUMNS.filter((c) => c.field !== 'lastCallTimeMs' && c.field !== 'firstCallTimeMs')
                    .map((c) => (
                      <SortableTh key={c.field} active={sortField === c.field} asc={sortAsc}
                        onClick={() => toggleSort(c.field)} className="text-right">
                        {c.label}
                      </SortableTh>
                    ))}
                  {/* avg* KHÔNG nằm trong whitelist sort của BE — bấm sort sẽ lặng lẽ rơi về
                      lastCallTimeMs, nên để Th thường thay vì SortableTh gây hiểu nhầm. */}
                  <Th className="text-right">Đổ chuông TB</Th>
                  <Th className="text-right">Đàm thoại TB</Th>
                  <SortableTh active={sortField === 'lastCallTimeMs'} asc={sortAsc}
                    onClick={() => toggleSort('lastCallTimeMs')}>
                    Gọi lần cuối
                  </SortableTh>
                  <Th className="w-20"> </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const style = STATUS_STYLE[row.bestStatus ?? ''] ?? {
                    label: row.bestStatus || '—', className: 'bg-gray-100 text-gray-600',
                  };
                  const lastStyle = STATUS_STYLE[row.lastStatus ?? ''];
                  return (
                    <tr key={`${row.phoneNumber}_${index}`} className="border-t border-(--color-line)">
                      <Td className="text-(--color-muted)">{(pageIndex - 1) * PAGE_SIZE + index + 1}</Td>
                      <Td>
                        <span className="font-medium">{row.phoneNumber}</span>
                        {row.contactName
                          ? <span className="ml-2 text-xs text-(--color-muted)">{row.contactName}</span>
                          : <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                              số lạ
                            </span>}
                      </Td>
                      <Td>
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.className}`}>
                          {style.label}
                        </span>
                      </Td>
                      <Td className="text-(--color-muted)">
                        {lastStyle ? lastStyle.label : (row.lastStatus || '—')}
                      </Td>
                      <Td className="text-right">
                        {(row.totalCall ?? 0).toLocaleString('vi-VN')}
                        {(row.retriedCalls ?? 0) > 0 && (
                          <span className="ml-1 text-xs font-semibold text-amber-700">
                            +{row.retriedCalls} gọi lại
                          </span>
                        )}
                      </Td>
                      <Td className="text-right">{(row.totalAnswered ?? 0).toLocaleString('vi-VN')}</Td>
                      <Td className="text-right">{formatDuration(row.totalBillSec)}</Td>
                      <Td className="text-right">{formatDuration(row.totalAnswerSec)}</Td>
                      <Td className="text-right">{formatMs(row.avgRingingTimeMs)}</Td>
                      <Td className="text-right">{formatMs(row.avgTalkTimeMs)}</Td>
                      <Td className="text-(--color-muted)">{formatTime(row.lastCallTimeMs)}</Td>
                      <Td>
                        <button type="button" onClick={() => setSelected(row)}
                          className="text-(--color-link) hover:underline">
                          Chi tiết
                        </button>
                      </Td>
                    </tr>
                  );
                })}
                {rows.length === 0 && !loading && (
                  <tr><td colSpan={12} className="py-6 text-center text-sm text-(--color-muted)">
                    Không có khách hàng nào khớp bộ lọc
                  </td></tr>
                )}
                {loading && rows.length === 0 && (
                  <tr><td colSpan={12} className="py-6 text-center text-sm text-(--color-muted)">Đang tải…</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-(--color-muted)">
              {total.toLocaleString('vi-VN')} khách hàng
              {loading && rows.length > 0 && ' · đang cập nhật…'}
            </span>
            {/* Cursor pagination: không có tổng số trang để hiển thị "trang x/y". */}
            <div className="flex items-center gap-2">
              <Button disabled={pageIndex <= 1 || loading} onClick={goPrev}>Trước</Button>
              <span className="text-(--color-muted)">Trang {pageIndex}</span>
              <Button disabled={!nextCursor || loading} onClick={goNext}>Sau</Button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <CustomerReportDetailDrawer
          sessionId={sessionId}
          sessionTimeMs={sessionTimeMs || anchorMs}
          row={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/**
 * Ô gõ ngưỡng để rỗng/0 thì rơi về mặc định thay vì gửi 0 (BE kẹp về 1, nhưng để UI và BE lệch
 * nhau thì người dùng thấy số mình gõ không phải số được tính).
 */
function clampTatDays(raw: string): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_TAT_DAYS;
  }
  return Math.min(n, MAX_TAT_DAYS);
}

/** `87,5%` kiểu vi-VN. null = chưa đo được khách nào → gạch ngang, KHÔNG phải 0%. */
function formatPercent(value: number | null): string {
  if (value == null) {
    return '—';
  }
  return `${value.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/**
 * Một ô TAT: phần trăm lớn + thanh tiến độ + dòng "Pass · Fail / tổng".
 * <p>
 * Mẫu số hiển thị là `measured` (khách ĐO ĐƯỢC) chứ không phải tổng khách của phiên — số khách
 * không đo được nêu riêng ở dòng chú thích chung bên dưới hai ô.
 */
function TatCard({ title, subtitle, bucket, tatDays, tone }: {
  title: string;
  subtitle: string;
  bucket: CustomerReportTatBucket;
  tatDays: number;
  tone: 'amber' | 'primary';
}) {
  const pct = bucket.passRate ?? 0;
  return (
    <div className="rounded-xl border border-(--color-line) p-3">
      <div className="text-sm font-semibold">
        {title} <span className="font-normal text-(--color-muted)">(&lt; {tatDays} ngày)</span>
      </div>
      <div className="mt-0.5 text-[11px] text-(--color-muted)">{subtitle}</div>
      <div className={`mt-2 text-3xl font-bold ${tone === 'amber' ? 'text-amber-600' : 'text-(--color-primary)'}`}>
        {formatPercent(bucket.passRate)}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--color-field)">
        <div className={`h-full ${tone === 'amber' ? 'bg-amber-500' : 'bg-(--color-primary)'}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div className="mt-2 text-[11px] text-(--color-muted)">
        Pass <b className="text-(--color-primary)">{bucket.pass.toLocaleString('vi-VN')}</b>
        {' · '}Fail <b className="text-(--color-danger)">{bucket.fail.toLocaleString('vi-VN')}</b>
        {' / '}{bucket.measured.toLocaleString('vi-VN')} khách đo được
      </div>
    </div>
  );
}

function SummaryTile({ label, value, hint, highlight }: {
  label: string; value: string; hint?: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 ${highlight
      ? 'border-(--color-primary) bg-(--color-primary-soft)'
      : 'border-(--color-line)'}`}>
      <div className="text-xs text-(--color-muted)">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${highlight ? 'text-(--color-primary-dark)' : ''}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-(--color-muted)">{hint}</div>}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-semibold ${className}`}>{children}</th>;
}

function SortableTh({ children, active, asc, onClick, className = '' }: {
  children: React.ReactNode; active: boolean; asc: boolean; onClick: () => void; className?: string;
}) {
  return (
    <th className={`px-3 py-2 font-semibold ${className}`}>
      <button type="button" onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-(--color-ink) ${active ? 'text-(--color-ink)' : ''}`}>
        {children}
        <span className={active ? '' : 'opacity-30'}>{active && asc ? '▲' : '▼'}</span>
      </button>
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

/** null = CHƯA TRA ĐƯỢC CDR, khác hẳn 0 giây — nên hiện "—" chứ không hiện "0s". */
function formatDuration(seconds?: number | null): string {
  if (seconds == null) return '—';
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}p ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * Thời lượng tính bằng MILI GIÂY (đổ chuông / đàm thoại) — khác `formatDuration` vốn nhận GIÂY.
 * Dưới 10s hiện 1 chữ số thập phân: đổ chuông thường vài giây, làm tròn về "3s" mất hết chi tiết.
 */
function formatMs(ms?: number | null): string {
  if (ms == null) return '—';
  if (ms <= 0) return '0s';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatDuration(Math.round(ms / 1000));
}

function formatTime(ms?: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
