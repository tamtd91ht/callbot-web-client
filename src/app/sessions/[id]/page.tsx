'use client';
/**
 * Chi tiết phiên + theo dõi khi đang chạy — bám màn chi tiết phiên AutoCall của OMICRM
 * (web-v2 MarketingAutoCallDetailV2 + MACDetailInfoV2 + MACrudPreviewV2).
 *
 * Giống AutoCall:
 *  - Header: tên + badge trạng thái + lý do dừng/huỷ + nhóm nút hành động theo trạng thái.
 *  - Khối KPI đếm số (tổng, còn lại, nghe máy, không nghe, lỗi…) + spinner khi đang chạy.
 *  - Khối cấu hình phiên (đầu số, kịch bản, phân bổ, khung giờ) ngay cạnh KPI.
 *  - Banner khi phiên nằm ngoài khung giờ cho phép gọi.
 *  - Bảng lịch sử cuộc gọi per-record, tách khỏi bảng data staging.
 *  - Xác nhận trước khi tạm dừng / huỷ; nhân bản để gọi lại.
 *
 * Khác AutoCall (có chủ ý): AutoCall cập nhật counters bằng document.getElementById().innerHTML
 * (di sản class component cũ). Ở đây dùng state React thuần — số liệu từ BE là TUYỆT ĐỐI nên
 * chỉ cần replace, không cộng dồn, và không có nguy cơ lệch giữa DOM và state.
 */
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientSession, DataRow, SessionCounters } from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';
import { ApiError } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { useSessionRealtime } from '@/lib/realtime';
import { evaluateTimeSlots } from '@/lib/timeSlots';
import { useCatalogs } from '@/lib/useCatalogs';
import { Button, Card, Tabs } from '@/components/ui';
import { AddCustomerDrawer } from '@/components/session/AddCustomerDrawer';
import { SessionDataTable } from '@/components/session/SessionDataTable';
import { JobsPanel } from '@/components/session/JobsPanel';
import { ReportPanel } from '@/components/session/ReportPanel';
import { SessionConfigPanel } from '@/components/session/SessionConfigPanel';
import { SessionActionDialog } from '@/components/session/SessionActionDialog';
import { CallHistoryTable } from '@/components/session/CallHistoryTable';
import { CustomerReportTable } from '@/components/session/CustomerReportTable';
import { CloneSessionDialog } from '@/components/session/CloneSessionDialog';
import { ScriptDetailDrawer } from '@/components/session/ScriptDetailDrawer';
import { scriptLabel } from '@/components/session/CatalogFields';

type SessionTab = 'history' | 'data' | 'customers';

/** Số dòng mỗi lần tải bảng data. Nhỏ để trang mở nhanh; muốn xem thêm thì bấm 'Tải thêm'. */
const ROWS_PAGE_SIZE = 200;

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [session, setSession] = useState<ClientSession | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [live, setLive] = useState<{ totalCalling: number; ccu: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scriptDetailOpen, setScriptDetailOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'pause' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  /**
   * Bộ lọc bảng data — ĐẶT Ở ĐÂY chứ không trong bảng, vì lọc nay chạy trên BE nên "bộ lọc hiện tại"
   * và "cursor" phải cùng một chủ sở hữu. Tách hai nơi là đổi filter mà cursor còn trỏ trang cũ.
   */
  const [dataFilter, setDataFilter] = useState<{ statusTab: string; source: string; search: string }>(
    { statusTab: 'ALL', source: 'ALL', search: '' });
  /** Cursor trang kế của bảng data; null = đã tải hết (gap BE #3 đã mở, xem searchRowsPage). */
  const [rowsCursor, setRowsCursor] = useState<unknown[] | null>(null);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<SessionTab>('history');
  const catalogs = useCatalogs();

  /** Chuyển bộ lọc UI thành tham số query của BE — một chỗ duy nhất để hai đường (reload/loadMore) khớp nhau. */
  const dataQuery = useCallback(() => ({
    // Tab "Đang/đã gọi" gộp QUEUED + DISPATCHED; các tab khác ánh xạ 1-1.
    rowStatuses: dataFilter.statusTab === 'ALL' ? undefined
      : dataFilter.statusTab === 'DISPATCHED' ? ['QUEUED', 'DISPATCHED'] : [dataFilter.statusTab],
    sources: dataFilter.source === 'ALL' ? undefined : [dataFilter.source],
    keyword: dataFilter.search.trim() || undefined,
    excludeRemoved: true, // bảng không bao giờ hiện dòng đã xoá
  }), [dataFilter]);

  const reload = useCallback(async () => {
    try {
      setSession(await sessionApi.getById(id));
      const first = await sessionApi.searchRowsPage(id, { size: ROWS_PAGE_SIZE, ...dataQuery() });
      setRows(first.rows);
      setRowsCursor(first.nextSearchAfter ?? null);
      setRowsTotal(first.total);
      setDataVersion((v) => v + 1); // báo ReportPanel / lịch sử gọi tải lại số liệu
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [id, dataQuery]);

  /**
   * Tải thêm một trang data.
   *
   * Cursor-only (search_after) nên chỉ đi TIẾN tuần tự — ES chặn from/size sâu ở 10.000 doc nên
   * nhảy tới trang bất kỳ sẽ hỏng đúng lúc phiên nhiều dữ liệu. Vì vậy UI là "Tải thêm", không
   * phải ô nhập số trang.
   */
  const loadMoreRows = useCallback(async () => {
    if (!rowsCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await sessionApi.searchRowsPage(id,
        { size: ROWS_PAGE_SIZE, searchAfter: rowsCursor, ...dataQuery() });
      // Nối thêm, KHÔNG thay thế — người dùng vừa cuộn qua các dòng trước đó.
      setRows((prev) => [...prev, ...next.rows]);
      setRowsCursor(next.nextSearchAfter ?? null);
      setRowsTotal(next.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [id, rowsCursor, loadingMore, dataQuery]);

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

  const runAction = useCallback(async (
    action: 'submit' | 'pause' | 'resume' | 'cancel',
    cause?: string,
    pauseMinutes?: number | null,
  ) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await sessionApi.action(id, action, cause, pauseMinutes));
      setConfirmAction(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [id, reload]);

  const activeRows = useMemo(() => rows.filter((r) => r.rowStatus !== 'REMOVED'), [rows]);

  if (!session) {
    return <Card>{error ? <span className="text-(--color-danger)">{error}</span> : 'Đang tải…'}</Card>;
  }

  const c: Partial<SessionCounters> = session.counters ?? {};
  const canAddData = session.status !== 'COMPLETED' && session.status !== 'CANCELED';
  const isRunning = session.status === 'RUNNING';
  const isTerminal = session.status === 'COMPLETED' || session.status === 'CANCELED';
  const scriptName = scriptLabel(session.scriptUuid ?? '', catalogs.scripts);
  const voiceLabel = session.voiceOverride
    ? catalogs.voices.find((v) => v.value === session.voiceOverride)?.label ?? session.voiceOverride
    : undefined;

  // Ngoài khung giờ: giải thích vì sao phiên RUNNING mà không nổ cuộc nào (AutoCall: pausedByOutTimeFrame)
  const window = evaluateTimeSlots(session.timeSlots, session.timezoneId);
  const showOutOfWindow = isRunning && !window.allowedNow;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/sessions')}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-(--color-field) hover:bg-gray-200">←</button>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-bold">
                {session.name}
                <span className={`badge ${session.status} align-middle`}>{session.status}</span>
                {isRunning && <Spinner />}
              </h1>
              {session.pausedCause && (
                <div className="text-xs text-amber-700">
                  Tạm dừng: {session.pausedCause}
                  {session.pauseUntilTimeMs
                    ? ` — tự chạy lại lúc ${new Date(session.pauseUntilTimeMs).toLocaleString('vi-VN')}`
                    : ' — chờ bạn bấm Tiếp tục'}
                </div>
              )}
              {session.cancelCause && <div className="text-xs text-red-700">Đã huỷ: {session.cancelCause}</div>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs ${connected ? 'text-(--color-primary-dark)' : 'text-(--color-muted)'}`}>
              {connected ? '● realtime' : '○ cập nhật mỗi 10s'}
            </span>
            {session.status === 'DRAFT' && (
              <Button variant="primary" disabled={busy} onClick={() => router.push('/sessions/new')}
                title="Mở lại màn cấu hình để hoàn tất phiên nháp">
                Sửa cấu hình
              </Button>
            )}
            {session.status === 'DRAFT' && (
              <Button variant="primary" disabled={busy} onClick={() => void runAction('submit')}>
                Tạo phiên
              </Button>
            )}
            {isRunning && (
              <Button disabled={busy} onClick={() => setConfirmAction('pause')}>Tạm dừng</Button>
            )}
            {session.status === 'PAUSED' && (
              <Button variant="primary" disabled={busy} onClick={() => void runAction('resume')}>Tiếp tục</Button>
            )}
            {['SCHEDULED', 'RUNNING', 'PAUSED'].includes(session.status) && (
              <Button variant="danger" disabled={busy} onClick={() => setConfirmAction('cancel')}>Huỷ phiên</Button>
            )}
            {isTerminal && (
              <Button variant="primary" disabled={busy} onClick={() => setCloneOpen(true)}
                title="Tạo phiên nháp mới từ phiên này">
                Gọi lại phiên
              </Button>
            )}
            {canAddData && (
              <Button variant="primary" onClick={() => setDrawerOpen(true)}>+ Thêm khách hàng</Button>
            )}
          </div>
        </div>

        {showOutOfWindow && (
          <div className="mt-3 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            Đang ngoài khung giờ cho phép gọi — phiên tạm nghỉ và sẽ tự phân bổ lại
            {window.nextOpenLabel ? <> vào <b>{window.nextOpenLabel}</b></> : ' khi tới khung giờ kế tiếp'}.
          </div>
        )}
        {error && <div className="mt-2 text-sm text-(--color-danger)">{error}</div>}
        {toast && !error && <div className="mt-2 text-sm text-(--color-primary-dark)">{toast}</div>}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-bold">Số liệu phiên</h3>
          {isRunning && <span className="text-xs text-(--color-muted)">Đang chạy — số liệu cập nhật liên tục</span>}
        </div>
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
          <Stat label="Không hợp lệ" value={c.invalid ?? 0} bad />
        </div>
      </Card>

      <Card>
        <SessionConfigPanel session={session} scriptName={scriptName} voiceLabel={voiceLabel} />
        {session.scriptUuid && (
          <button className="mt-3 text-sm font-semibold text-(--color-link) hover:underline"
            onClick={() => setScriptDetailOpen(true)}>
            Xem chi tiết kịch bản
          </button>
        )}
      </Card>

      <Card>
        <ReportPanel sessionId={id} refreshKey={dataVersion} />
      </Card>

      <Card>
        <JobsPanel sessionId={id} isDraft={session.status === 'DRAFT'} onFinished={() => void reload()} />
      </Card>

      {/*
        Tách 3 bảng — ba khái niệm khác nhau và người vận hành RẤT hay lẫn:
          lịch sử CUỘC GỌI (1 khách retry 3 lần = 3 dòng)
          · DATA đã nạp (staging, có dòng trùng/lỗi)
          · KHÁCH HÀNG (1 khách = 1 dòng dù gọi lại mấy lần)
      */}
      <div className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white">
        <Tabs active={tab} onChange={(key) => setTab(key as SessionTab)}
          tabs={[
            { key: 'history', label: 'Lịch sử cuộc gọi' },
            { key: 'data', label: `Data đã nạp (${activeRows.length.toLocaleString('vi-VN')})` },
            { key: 'customers', label: 'Báo cáo khách hàng' },
          ]} />
        <div className="p-5">
          {tab === 'customers' ? (
            <CustomerReportTable session={session} refreshKey={dataVersion} />
          ) : tab === 'history' ? (
            <CallHistoryTable session={session} refreshKey={dataVersion} />
          ) : (
            <SessionDataTable
              rows={rows}
              scriptName={scriptName}
              totalRows={c.total ?? rowsTotal}
              counters={session.counters ?? undefined}
              filter={dataFilter}
              onFilterChange={(next) => setDataFilter(next)}
              hasMore={rowsCursor != null}
              loadingMore={loadingMore}
              onLoadMore={loadMoreRows}
              onDelete={canAddData ? async (rowIds) => {
                await sessionApi.removeRows(id, rowIds);
                await reload();
              } : undefined}
              onEditRow={canAddData ? async (rowId, phoneNumber) => {
                await sessionApi.updateRow(id, rowId, phoneNumber);
                await reload();
              } : undefined}
              onRestoreDuplicate={canAddData ? async (rowId) => {
                await sessionApi.restoreDuplicate(id, rowId);
                await reload();
              } : undefined}
            />
          )}
        </div>
      </div>

      <SessionActionDialog open={confirmAction !== null} action={confirmAction}
        sessionName={session.name} remaining={c.remaining ?? 0} busy={busy}
        onClose={() => setConfirmAction(null)}
        onConfirm={(cause, pauseMinutes) => void runAction(confirmAction!, cause, pauseMinutes)} />

      <CloneSessionDialog open={cloneOpen} session={session} busy={busy}
        onClose={() => setCloneOpen(false)}
        onConfirm={async ({ copyConfig, callStatuses, name }) => {
          setBusy(true);
          setError(null);
          try {
            const result = await sessionApi.clone({
              sourceSessionId: id,
              copyConfig,
              dataFilter: callStatuses ? { callStatuses } : null,
              name,
            });
            setCloneOpen(false);
            router.push(`/sessions/${result.session.id}`);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }} />

      <ScriptDetailDrawer open={scriptDetailOpen} scriptUuid={session.scriptUuid ?? ''}
        fallbackName={scriptName} onClose={() => setScriptDetailOpen(false)} />

      <AddCustomerDrawer open={drawerOpen} initialTab="manual"
        sessionStatus={session.status}
        onClose={() => { setDrawerOpen(false); void reload(); }}
        ensureSessionId={async () => id}
        onAdded={(r) => {
          setToast(`Đã thêm: ${r.inserted} mới · ${r.duplicated} trùng · ${r.invalid} không hợp lệ`);
          void reload();
        }} />
    </div>
  );
}

function Stat({ label, value, highlight, good, bad }: {
  label: string; value: number | string; highlight?: boolean; good?: boolean; bad?: boolean;
}) {
  const isZero = value === 0 || value === '—';
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${
      highlight ? 'border-(--color-primary) bg-(--color-primary-soft)' : 'border-(--color-line) bg-(--color-field)'}`}>
      <div className="text-xs text-(--color-muted)">{label}</div>
      <div className={`text-xl font-bold ${
        // số 0 để màu trung tính: tô đỏ "Lỗi: 0" làm người đọc giật mình vô cớ
        isZero ? '' : good ? 'text-(--color-primary-dark)' : bad ? 'text-(--color-danger)' : ''}`}>
        {typeof value === 'number' ? value.toLocaleString('vi-VN') : value}
      </div>
    </div>
  );
}

/** Spinner cạnh badge khi phiên đang chạy — AutoCall cũng quay logo lúc processing. */
function Spinner() {
  return (
    <span aria-label="đang chạy"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-(--color-primary) border-t-transparent" />
  );
}
