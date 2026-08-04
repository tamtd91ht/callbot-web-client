'use client';
/**
 * Màn "Tạo phiên" theo template docs/ui/img*.png (repo callbot-service).
 * Draft-first: draft được tạo ngầm ở lần thao tác đầu cần id (mở drawer/nạp data/lưu);
 * "Tạo phiên" = submit luôn (quyết định user), "Lưu nháp" = chỉ lưu, "Đóng" → draft còn trong danh sách.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientSession, DataRow, SipNumber, UpdateSessionRequest } from '@/contracts/types';
import { ApiError, get, post, api } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { Button, Card, Field, inputClass } from '../ui';
import { AddCustomerDrawer } from './AddCustomerDrawer';
import { DistributionModal, distributionSummary, type DistributionValue } from './DistributionModal';
import { SessionDataTable } from './SessionDataTable';
import { VariablePriorityChips } from './VariablePriorityChips';
import { CUSTOMER_QUOTA, PURPOSES, SCRIPTS, VARIABLE_SOURCES } from './catalogs';
import { ScriptField, SipNumbersField, VoiceField, scriptLabel } from './CatalogFields';
import { useCatalogs } from '@/lib/useCatalogs';
import { IS_REAL } from '@/lib/sessionApi';

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
    purpose: PURPOSES[0],
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

export function CreateSessionScreen() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(defaultForm);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [drawer, setDrawer] = useState<null | 'manual' | 'excel' | 'crm'>(null);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const creating = useRef<Promise<string> | null>(null);
  const catalogs = useCatalogs();

  const patch = useCallback((update: Partial<FormState>) => setForm((f) => ({ ...f, ...update })), []);

  /** name luôn có giá trị (fallback theo thời gian) nên dùng được cho cả create và update. */
  function toRequest(f: FormState): UpdateSessionRequest & { name: string; sipNumbers: SipNumber[] } {
    return {
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
    };
  }

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
  }, [session, form]);

  const refreshRows = useCallback(async () => {
    if (!session) return;
    setRows(await sessionApi.searchRows(session.id));
  }, [session]);

  useEffect(() => { void refreshRows(); }, [refreshRows]);

  async function saveConfig(): Promise<string> {
    const id = await ensureSessionId();
    const updated = await sessionApi.update(id, toRequest(form));
    setSession(updated);
    return id;
  }

  async function saveDraft() {
    setBusy(true); setError(null);
    try {
      await saveConfig();
      setToast('Đã lưu nháp — phiên nằm trong danh sách, quay lại sửa bất kỳ lúc nào');
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      const id = await saveConfig();
      await sessionApi.action(id, 'submit');
      router.push(`/sessions/${id}`);
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function deleteRows(rowIds: string[]) {
    if (!session) return;
    await sessionApi.removeRows(session.id, rowIds);
    await refreshRows();
  }

  const summary = distributionSummary(form.distribution);
  const activeRows = useMemo(() => rows.filter((r) => r.rowStatus !== 'REMOVED'), [rows]);
  const countBySource = (src: string) => activeRows.filter((r) => r.source === src).length;
  const scriptName = scriptLabel(form.scriptUuid, catalogs.scripts);

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/sessions')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow hover:bg-gray-50">←</button>
          <div>
            <h1 className="text-xl font-bold">Tạo phiên</h1>
            <div className="mt-1 h-1 w-8 rounded bg-(--color-primary)" />
          </div>
        </div>
        <button className="text-sm text-(--color-muted) hover:text-(--color-ink)"
          onClick={() => { setForm(defaultForm()); setToast('Đã đặt lại cấu hình (data đã nạp giữ nguyên)'); }}>
          Đặt lại cấu hình
        </button>
      </div>

      <Card className="mb-4">
        <h2 className="mb-4 text-[17px] font-bold">Cấu hình gửi</h2>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* ===== Cột trái: cấu hình ===== */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tên phiên">
                <input className={inputClass} placeholder="Phiên thủ công" value={form.name}
                  onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="Mục đích cuộc gọi">
                <select className={inputClass} value={form.purpose} onChange={(e) => patch({ purpose: e.target.value })}>
                  {PURPOSES.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Thời gian gửi">
              <input type="datetime-local" className={inputClass} value={form.startTimeLocal}
                onChange={(e) => patch({ startTimeLocal: e.target.value })} />
            </Field>

            <SipNumbersField value={form.sipNumbers} onChange={(sipNumbers) => patch({ sipNumbers })} catalogs={catalogs} />

            {/* [FR-008] mockup: block "Thời gian chờ kết nối tối đa" ngay dưới Đầu số */}
            <Field label="Thời gian chờ kết nối tối đa">
              <div className="flex items-center gap-2">
                <input type="number" min={5} max={60} className={`${inputClass} max-w-28`}
                  value={form.ringTimeoutSeconds}
                  onChange={(e) => patch({ ringTimeoutSeconds: e.target.value })} />
                <span className="text-sm text-(--color-muted)">
                  giây — ngắt cuộc nếu không kết nối được (5–60; bỏ trống = mặc định tổng đài 60s)
                </span>
              </div>
            </Field>

            <h3 className="pt-2 text-[15px] font-bold">Thành phần cuộc gọi</h3>

            <ScriptField value={form.scriptUuid} onChange={(scriptUuid) => patch({ scriptUuid })} catalogs={catalogs} />

            <VoiceField value={form.voiceOverride} onChange={(voiceOverride) => patch({ voiceOverride })} catalogs={catalogs} />

            {/* Card tóm tắt phân bổ — như template */}
            <div className="rounded-(--radius-field) bg-(--color-field) px-4 py-3">
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
            </div>

            <div className="pt-2">
              <VariablePriorityChips order={form.variableOrder} onChange={(order) => patch({ variableOrder: order })} />
            </div>
          </div>

          {/* ===== Cột phải: hình thức thêm khách hàng ===== */}
          <div>
            <h3 className="mb-3 text-[17px] font-semibold text-(--color-muted)">Hình thức thêm khách hàng</h3>
            <div className="flex flex-wrap gap-3">
              <SourceButton icon="⌨️" label="Thủ công" count={countBySource('MANUAL')} onClick={() => setDrawer('manual')} />
              <SourceButton icon="📄" label="File Excel" count={countBySource('EXCEL')} onClick={() => setDrawer('excel')} />
              <SourceButton icon="🪪" label="Thuộc tính khách hàng" count={countBySource('CRM')} onClick={() => setDrawer('crm')} />
            </div>
            <p className="mt-3 text-sm text-(--color-muted)">
              Tổng đã nạp: <b>{activeRows.length.toLocaleString('vi-VN')}</b>/{CUSTOMER_QUOTA.toLocaleString('vi-VN')} khách hàng
              {session && <> · phiên nháp <code className="rounded bg-(--color-field) px-1">{session.id}</code></>}
            </p>
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
          <Button variant="primary" disabled={busy} onClick={submit} className="px-8 py-2.5">
            {busy ? 'Đang xử lý…' : 'Tạo phiên'}
          </Button>
          <Button disabled={busy} onClick={saveDraft}>Lưu nháp</Button>
          <Button disabled={busy} onClick={() => router.push('/sessions')}>Đóng</Button>
          {error && <span className="text-sm text-(--color-danger)">{error}</span>}
          {toast && !error && <span className="text-sm text-(--color-primary-dark)">{toast}</span>}
        </div>
      </div>

      <DistributionModal open={distributionOpen} value={form.distribution}
        onClose={() => setDistributionOpen(false)}
        onSave={(v) => patch({ distribution: v })} />

      <AddCustomerDrawer open={drawer !== null} initialTab={drawer ?? 'manual'}
        sessionStatus={session?.status ?? 'DRAFT'}
        onClose={() => { setDrawer(null); void refreshRows(); }}
        ensureSessionId={ensureSessionId}
        onAdded={(r) => {
          setToast(`Đã thêm: ${r.inserted} mới · ${r.duplicated} trùng · ${r.invalid} không hợp lệ`);
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
