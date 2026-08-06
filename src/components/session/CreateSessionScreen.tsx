'use client';
/**
 * Màn "Tạo phiên" — bám UX luồng tạo phiên AutoCall của OMICRM (web-v2
 * containers/marketing/crud/auto-call/create-v2), áp cho CallBot.
 *
 * Giống AutoCall:
 *  - MỘT trang form (không wizard), 2 cột: trái cấu hình, phải nguồn thêm khách hàng.
 *  - Draft-first: phiên được tạo server-side TRƯỚC khi submit; nút cuối chỉ publish.
 *  - Autosave debounce 2s sau mỗi thay đổi (AutoCall: handleSaveCurrentSession).
 *  - Validate gom hết lỗi rồi focus field lỗi ĐẦU TIÊN (AutoCall: validateData + setRefId).
 *  - Chặn mở drawer thêm khách hàng khi chưa chọn kịch bản (AutoCall: validateContent).
 *  - Dialog xác nhận trước khi publish (AutoCall: MarketingDialogConfirmCreate).
 *
 * Khác AutoCall (có chủ ý):
 *  - CallBot chọn ĐÚNG 1 kịch bản, nên không có mảng "thành phần cuộc gọi"; chỗ trống đó dùng
 *    để hiện luôn biến kịch bản cần nạp.
 *  - Bỏ kiểu phân bổ "dynamic" (AutoCall cần nhóm nội bộ — CallBot không có khái niệm này).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientSession, DataRow, SipNumber, UpdateSessionRequest } from '@/contracts/types';
import { ApiError } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { Button, Card, Field, inputClass } from '../ui';
import { AddCustomerDrawer } from './AddCustomerDrawer';
import { DistributionModal, distributionSummary, type DistributionValue } from './DistributionModal';
import { SessionDataTable } from './SessionDataTable';
import { VariablePriorityChips } from './VariablePriorityChips';
import { ConfirmCreateDialog, type ConfirmCreateSummary } from './ConfirmCreateDialog';
import { ScriptDetailDrawer } from './ScriptDetailDrawer';
import { CUSTOMER_QUOTA, PURPOSES, SCRIPTS, VARIABLE_SOURCES } from './catalogs';
import { PurposeField, ScriptField, SipNumbersField, VoiceField, scriptLabel } from './CatalogFields';
import { useCatalogs } from '@/lib/useCatalogs';
import { IS_REAL } from '@/lib/sessionApi';
import { useUnsavedGuard } from '@/lib/useUnsavedGuard';
import {
  firstErrorField, hasErrors, validateForSubmit, type FieldErrors, type SessionFieldKey,
} from '@/lib/validation';

interface FormState {
  name: string;
  purpose: string;
  startTimeLocal: string; // datetime-local
  sipNumbers: SipNumber[];
  scriptUuid: string;
  voiceOverride: string;
  /** [FR-008] '' = theo mặc định tổng đài (60s). */
  ringTimeoutSeconds: string;
  distribution: DistributionValue;
  variableOrder: string[];
}

function defaultForm(): FormState {
  const in5m = new Date(Date.now() + 5 * 60_000);
  in5m.setSeconds(0, 0);
  return {
    name: '',
    // Real mode để TRỐNG: mục đích là danh mục riêng của từng doanh nghiệp, chọn sẵn một giá trị
    // hardcode sẽ gửi lên chuỗi không có trong danh mục của họ.
    purpose: IS_REAL ? '' : PURPOSES[0],
    startTimeLocal: toLocalInput(in5m),
    // Đầu số mặc định TRỐNG ở mọi mode (quyết định owner 2026-08-04) — người dùng tự mở
    // dropdown chọn. Kịch bản real mode cũng để trống (chọn sẵn mock là ăn CS_SCRIPT_NOT_FOUND).
    sipNumbers: [],
    scriptUuid: IS_REAL ? '' : SCRIPTS[0].uuid,
    voiceOverride: '',
    ringTimeoutSeconds: '30', // mặc định MAFC theo mockup FR-008

    distribution: {
      batchSize: 10, batchIntervalSeconds: 30, timeSlots: [],
      retryConfig: null,
    },
    variableOrder: VARIABLE_SOURCES.map((s) => s.key),
  };
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Autosave giống AutoCall: 2s sau lần thay đổi cuối. */
const AUTOSAVE_DELAY_MS = 2000;

export function CreateSessionScreen() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(defaultForm);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [drawer, setDrawer] = useState<null | 'manual' | 'excel' | 'crm'>(null);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [scriptDetailOpen, setScriptDetailOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  /** Kịch bản lúc data được nạp — đổi kịch bản sau đó thì biến có thể lệch (AutoCall: confirmChange). */
  const [scriptAtLoad, setScriptAtLoad] = useState<string | null>(null);
  const creating = useRef<Promise<string> | null>(null);
  const catalogs = useCatalogs();
  const { confirmLeave } = useUnsavedGuard(dirty);

  // ref để scroll/focus field lỗi đầu tiên
  const fieldRefs = useRef<Partial<Record<SessionFieldKey, HTMLElement | null>>>({});
  const setFieldRef = (key: SessionFieldKey) => (node: HTMLElement | null) => {
    fieldRefs.current[key] = node;
  };

  const patch = useCallback((update: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...update }));
    setDirty(true);
    // xoá lỗi của đúng field vừa sửa để nhãn đỏ không dính mãi
    setErrors((prev) => {
      const keys = Object.keys(update) as SessionFieldKey[];
      if (!keys.some((k) => prev[k])) return prev;
      const next = { ...prev };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  }, []);

  /** name luôn có giá trị (fallback theo thời gian) nên dùng được cho cả create và update. */
  const toRequest = useCallback((f: FormState): UpdateSessionRequest & { name: string; sipNumbers: SipNumber[] } => ({
    name: f.name || `Phiên ${new Date().toLocaleString('vi-VN')}`,
    purpose: f.purpose,
    startTimeMs: f.startTimeLocal ? new Date(f.startTimeLocal).getTime() : null,
    sipNumbers: f.sipNumbers,
    scriptUuid: f.scriptUuid,
    voiceOverride: f.voiceOverride || null,
    ringTimeoutSeconds: f.ringTimeoutSeconds.trim() ? Number(f.ringTimeoutSeconds) : null,
    batchSize: f.distribution.batchSize,
    batchIntervalSeconds: f.distribution.batchIntervalSeconds,
    timeSlots: f.distribution.timeSlots,
    retryConfig: f.distribution.retryConfig,
    variableOrder: f.variableOrder,
  }), []);

  /** Tạo draft ngầm 1 lần duy nhất (chống double-create khi 2 thao tác song song). */
  const ensureSessionId = useCallback(async (): Promise<string> => {
    if (session) return session.id;
    if (!creating.current) {
      creating.current = sessionApi.create(toRequest(form)).then((s) => {
        setSession(s);
        return s.id;
      }).catch((e) => { creating.current = null; throw e; });
    }
    return creating.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, form, toRequest]);

  const refreshRows = useCallback(async () => {
    if (!session) return;
    setRows(await sessionApi.searchRows(session.id));
  }, [session]);

  useEffect(() => { void refreshRows(); }, [refreshRows]);

  const saveConfig = useCallback(async (): Promise<string> => {
    const id = await ensureSessionId();
    const updated = await sessionApi.update(id, toRequest(form));
    setSession(updated);
    setDirty(false);
    return id;
  }, [ensureSessionId, form, toRequest]);

  /**
   * Autosave — CHỈ khi draft đã tồn tại. Cố ý không tự tạo draft từ autosave: người dùng mới
   * gõ một chữ vào tên phiên đã sinh ra phiên nháp trên server là hành vi bất ngờ.
   */
  useEffect(() => {
    if (!dirty || !session) return;
    setAutosaveState('saving');
    const timer = setTimeout(() => {
      sessionApi.update(session.id, toRequest(form))
        .then((updated) => {
          setSession(updated);
          setDirty(false);
          setAutosaveState('saved');
        })
        .catch(() => setAutosaveState('idle')); // lỗi autosave im lặng — nút "Lưu nháp" sẽ báo rõ
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, session?.id, form, toRequest]);

  const activeRows = useMemo(() => rows.filter((r) => r.rowStatus !== 'REMOVED'), [rows]);

  function focusFirstError(nextErrors: FieldErrors) {
    const field = firstErrorField(nextErrors);
    if (!field) return;
    const node = fieldRefs.current[field];
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) node.focus();
  }

  /** Gate mở drawer thêm khách hàng — AutoCall chặn khi chưa có nội dung cuộc gọi. */
  function openAddCustomer(tab: 'manual' | 'excel' | 'crm') {
    if (!form.scriptUuid) {
      const nextErrors: FieldErrors = { scriptUuid: 'Chọn kịch bản trước khi thêm khách hàng' };
      setErrors(nextErrors);
      setError('Chọn kịch bản AI Callbot trước — biến của kịch bản quyết định các cột dữ liệu cần nạp');
      focusFirstError(nextErrors);
      return;
    }
    setError(null);
    setDrawer(tab);
  }

  async function saveDraft() {
    setBusy(true); setError(null);
    try {
      await saveConfig();
      setAutosaveState('saved');
      setToast('Đã lưu nháp — phiên nằm trong danh sách, quay lại sửa bất kỳ lúc nào');
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  /** Bước 1 của submit: validate + mở dialog xác nhận. */
  function requestSubmit() {
    const nextErrors = validateForSubmit(form, activeRows.length);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      setError('Còn thông tin chưa hợp lệ — kiểm tra các ô được tô đỏ');
      focusFirstError(nextErrors);
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  /** Bước 2: lưu cấu hình rồi publish. */
  async function submit() {
    setBusy(true); setError(null);
    try {
      const id = await saveConfig();
      await sessionApi.action(id, 'submit');
      setDirty(false);
      router.push(`/sessions/${id}`);
    } catch (e) {
      setConfirmOpen(false);
      setError(e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function deleteRows(rowIds: string[]) {
    if (!session) return;
    await sessionApi.removeRows(session.id, rowIds);
    await refreshRows();
  }

  function close() {
    if (!confirmLeave()) return;
    router.push('/sessions');
  }

  const summary = distributionSummary(form.distribution);
  const countBySource = (src: string) => activeRows.filter((r) => r.source === src).length;
  const scriptName = scriptLabel(form.scriptUuid, catalogs.scripts);
  const scriptChangedAfterLoad = !!scriptAtLoad && scriptAtLoad !== form.scriptUuid && activeRows.length > 0;

  const confirmSummary: ConfirmCreateSummary = {
    name: form.name || `Phiên ${new Date().toLocaleString('vi-VN')}`,
    purpose: form.purpose,
    scriptName,
    voiceLabel: form.voiceOverride
      ? catalogs.voices.find((v) => v.value === form.voiceOverride)?.label ?? form.voiceOverride
      : 'Theo kịch bản',
    sipNumbers: form.sipNumbers,
    startTimeMs: form.startTimeLocal ? new Date(form.startTimeLocal).getTime() : null,
    batchSize: form.distribution.batchSize,
    batchIntervalSeconds: form.distribution.batchIntervalSeconds,
    timeSlots: form.distribution.timeSlots,
    retryConfig: form.distribution.retryConfig,
    ringTimeoutSeconds: form.ringTimeoutSeconds.trim() ? Number(form.ringTimeoutSeconds) : null,
    totalRows: activeRows.length,
  };

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={close}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow hover:bg-gray-50">←</button>
          <div>
            <h1 className="text-xl font-bold">Tạo phiên</h1>
            <div className="mt-1 h-1 w-8 rounded bg-(--color-primary)" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <AutosaveBadge state={autosaveState} dirty={dirty} hasDraft={!!session} />
          <button className="text-sm text-(--color-muted) hover:text-(--color-ink)"
            onClick={() => {
              if (!window.confirm('Đặt lại toàn bộ cấu hình về mặc định? Khách hàng đã nạp vẫn giữ nguyên.')) return;
              setForm(defaultForm());
              setErrors({});
              setDirty(true);
              setToast('Đã đặt lại cấu hình (data đã nạp giữ nguyên)');
            }}>
            Đặt lại cấu hình
          </button>
        </div>
      </div>

      <Card className="mb-4">
        <h2 className="mb-4 text-[17px] font-bold">Cấu hình gửi</h2>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* ===== Cột trái: cấu hình ===== */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={errors.name || 'Tên phiên'} invalid={!!errors.name}>
                <input ref={setFieldRef('name')} className={inputClass} placeholder="Phiên thủ công"
                  value={form.name} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <PurposeField value={form.purpose} onChange={(purpose) => patch({ purpose })} catalogs={catalogs} />
            </div>

            <Field label={errors.startTimeLocal || 'Thời gian gửi'} invalid={!!errors.startTimeLocal}>
              <input ref={setFieldRef('startTimeLocal')} type="datetime-local" className={inputClass}
                value={form.startTimeLocal} onChange={(e) => patch({ startTimeLocal: e.target.value })} />
            </Field>

            <SipNumbersField value={form.sipNumbers} onChange={(sipNumbers) => patch({ sipNumbers })}
              catalogs={catalogs} error={errors.sipNumbers} anchorRef={setFieldRef('sipNumbers')} />

            {/* [FR-008] mockup: block "Thời gian chờ kết nối tối đa" ngay dưới Đầu số */}
            <Field label={errors.ringTimeoutSeconds || 'Thời gian chờ kết nối tối đa'}
              invalid={!!errors.ringTimeoutSeconds}>
              <div className="flex items-center gap-2">
                <input ref={setFieldRef('ringTimeoutSeconds')} type="number" min={5} max={60}
                  className={`${inputClass} max-w-28`}
                  value={form.ringTimeoutSeconds}
                  onChange={(e) => patch({ ringTimeoutSeconds: e.target.value })} />
                <span className="text-sm text-(--color-muted)">
                  giây — ngắt cuộc nếu không kết nối được (5–60; bỏ trống = mặc định tổng đài 60s)
                </span>
              </div>
            </Field>

            <h3 className="pt-2 text-[15px] font-bold">Thành phần cuộc gọi</h3>

            <ScriptField value={form.scriptUuid} onChange={(scriptUuid) => patch({ scriptUuid })}
              catalogs={catalogs} error={errors.scriptUuid} fieldRef={setFieldRef('scriptUuid')}
              onViewDetail={() => setScriptDetailOpen(true)} />

            {/* AutoCall hiện nút "Cập nhật cho KH đã thêm" khi đổi kịch bản sau khi đã nạp data.
                Ở CallBot data staging không gắn cứng vào kịch bản, nên chỉ cần cảnh báo lệch biến. */}
            {scriptChangedAfterLoad && (
              <div className="rounded-lg bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                Bạn đã đổi kịch bản sau khi nạp {activeRows.length.toLocaleString('vi-VN')} khách hàng.
                Kiểm tra lại các biến kịch bản mới có khớp dữ liệu đã nạp không — thiếu biến thì cuộc gọi
                sẽ đọc sai hoặc bị đánh không hợp lệ.
              </div>
            )}

            <VoiceField value={form.voiceOverride} onChange={(voiceOverride) => patch({ voiceOverride })} catalogs={catalogs} />

            {/* Card tóm tắt phân bổ — như template */}
            <div ref={setFieldRef('distribution')}
              className={`rounded-(--radius-field) px-4 py-3 ${
                errors.distribution ? 'bg-red-50 ring-1 ring-(--color-danger)' : 'bg-(--color-field)'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold">
                  <span>🖥️</span> {summary.line1}
                </div>
                <button className="text-sm font-semibold text-(--color-link) hover:underline" onClick={() => setDistributionOpen(true)}>
                  Thay đổi
                </button>
              </div>
              <div className="mt-1 text-sm text-(--color-muted)">{summary.line2}</div>
              <div className="mt-1 flex items-center gap-1.5 text-sm">
                <span className={summary.retryOn ? 'text-(--color-primary-dark)' : 'text-(--color-danger)'}>
                  {summary.retryOn ? '✔' : '⊗'}
                </span>
                Gọi lại khi không nghe máy
                {summary.retryOn && form.distribution.retryConfig && (
                  <span className="text-(--color-muted)">
                    — tối đa {form.distribution.retryConfig.maxRetry} lần, sau {form.distribution.retryConfig.delaySeconds}s
                  </span>
                )}
              </div>
              {errors.distribution && (
                <div className="mt-2 text-xs font-semibold text-(--color-danger)">{errors.distribution}</div>
              )}
            </div>

            <div className="pt-2">
              <VariablePriorityChips order={form.variableOrder} onChange={(order) => patch({ variableOrder: order })} />
            </div>
          </div>

          {/* ===== Cột phải: hình thức thêm khách hàng ===== */}
          <div ref={setFieldRef('rows')}>
            <h3 className="mb-3 text-[17px] font-semibold text-(--color-muted)">Hình thức thêm khách hàng</h3>
            <div className="flex flex-wrap gap-3">
              <SourceButton icon="⌨️" label="Thủ công" count={countBySource('MANUAL')} onClick={() => openAddCustomer('manual')} />
              <SourceButton icon="📄" label="File Excel" count={countBySource('EXCEL')} onClick={() => openAddCustomer('excel')} />
              <SourceButton icon="🪪" label="Thuộc tính khách hàng" count={countBySource('CRM')} onClick={() => openAddCustomer('crm')} />
            </div>
            <p className="mt-3 text-sm text-(--color-muted)">
              Tổng đã nạp: <b>{activeRows.length.toLocaleString('vi-VN')}</b>/{CUSTOMER_QUOTA.toLocaleString('vi-VN')} khách hàng
              {session && <> · phiên nháp <code className="rounded bg-(--color-field) px-1">{session.id}</code></>}
            </p>
            {errors.rows && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-(--color-danger)">
                {errors.rows}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Bảng data */}
      <Card>
        <SessionDataTable rows={rows} scriptName={scriptName} onDelete={deleteRows} />
      </Card>

      {/* Footer sticky */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-line) bg-white/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-350 items-center gap-3">
          <Button variant="primary" disabled={busy} onClick={requestSubmit} className="px-8 py-2.5">
            {busy ? 'Đang xử lý…' : 'Tạo phiên'}
          </Button>
          <Button disabled={busy} onClick={saveDraft}>Lưu nháp</Button>
          <Button disabled={busy} onClick={close}>Đóng</Button>
          {error && <span className="text-sm text-(--color-danger)">{error}</span>}
          {toast && !error && <span className="text-sm text-(--color-primary-dark)">{toast}</span>}
        </div>
      </div>

      <DistributionModal open={distributionOpen} value={form.distribution}
        onClose={() => setDistributionOpen(false)}
        onSave={(v) => patch({ distribution: v })} />

      <ScriptDetailDrawer open={scriptDetailOpen} scriptUuid={form.scriptUuid} fallbackName={scriptName}
        onClose={() => setScriptDetailOpen(false)} />

      <ConfirmCreateDialog open={confirmOpen} summary={confirmSummary} busy={busy}
        onClose={() => setConfirmOpen(false)} onConfirm={submit} />

      <AddCustomerDrawer open={drawer !== null} initialTab={drawer ?? 'manual'}
        sessionStatus={session?.status ?? 'DRAFT'}
        onClose={() => { setDrawer(null); void refreshRows(); }}
        ensureSessionId={ensureSessionId}
        onAdded={(r) => {
          setToast(`Đã thêm: ${r.inserted} mới · ${r.duplicated} trùng · ${r.invalid} không hợp lệ`);
          setErrors((prev) => { const next = { ...prev }; delete next.rows; return next; });
          // ghi nhận kịch bản tại thời điểm nạp để cảnh báo nếu sau đó người dùng đổi kịch bản
          setScriptAtLoad((prev) => prev ?? form.scriptUuid);
          void refreshRows();
        }} />
    </div>
  );
}

function SourceButton({ icon, label, count, onClick }: { icon: string; label: string; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 rounded-lg bg-(--color-primary) px-5 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:bg-(--color-primary-dark)">
      <span>{icon}</span> {label}
      <span className="font-normal opacity-90">{count.toLocaleString('vi-VN')}/{CUSTOMER_QUOTA.toLocaleString('vi-VN')}</span>
    </button>
  );
}

/** Chỉ báo autosave — người dùng cần biết cấu hình đã được giữ, nhất là khi rời trang. */
function AutosaveBadge({ state, dirty, hasDraft }: {
  state: 'idle' | 'saving' | 'saved'; dirty: boolean; hasDraft: boolean;
}) {
  if (!hasDraft) {
    return <span className="text-xs text-(--color-muted)">Chưa lưu — bấm “Lưu nháp” để giữ cấu hình</span>;
  }
  if (dirty && state === 'saving') return <span className="text-xs text-(--color-muted)">Đang lưu…</span>;
  if (dirty) return <span className="text-xs text-(--color-muted)">Có thay đổi chưa lưu</span>;
  if (state === 'saved') return <span className="text-xs text-(--color-primary-dark)">✔ Đã lưu nháp</span>;
  return null;
}
