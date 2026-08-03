'use client';
/**
 * Drawer "Thêm khách hàng" — 3 tab như template img_1/img_2:
 *   Thủ công: input + autocomplete contact CRM → "Danh sách thêm khả dụng" (staging) → chốt thêm
 *   File Excel: client CHỈ gửi FormData — mock parse tại BFF, real đẩy nguyên file xuống BE
 *     (parse nền, có file dòng lỗi) → tab tự theo dõi batch cho tới khi xong
 *   Thuộc tính khách hàng: filter → đếm trước (preview) → nạp snapshot chạy nền (source=CRM)
 */
import { useEffect, useRef, useState } from 'react';
import type {
  AppendMode, ClientSessionStatus, ContactSuggestion, CrmContactFilter, DataRow,
  ImportBatch, ImportExcelResult,
} from '@/contracts/types';
import { ApiError, api, get, post } from '@/lib/apiClient';
import { Button, Drawer, Tabs, inputClass } from '../ui';
import { COUNTRY_CODE_OPTIONS, type CountryCodeOption, applyCountryCode } from './catalogs';

interface StagedCustomer { name: string; phone: string; variables?: Record<string, string> }

export function AddCustomerDrawer({
  open, initialTab, sessionStatus, onClose, ensureSessionId, onAdded,
}: {
  open: boolean;
  initialTab: 'manual' | 'excel' | 'crm';
  sessionStatus: ClientSessionStatus;
  onClose: () => void;
  ensureSessionId: () => Promise<string>;
  onAdded: (result: { inserted: number; duplicated: number; invalid: number }) => void;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  const running = sessionStatus === 'RUNNING' || sessionStatus === 'PAUSED';
  const [appendMode, setAppendMode] = useState<AppendMode>('RUN_AFTER');

  return (
    <Drawer open={open} onClose={onClose}>
      <div className="flex h-full flex-col">
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: 'manual', label: <>Thủ công <span className="ml-1">⌨️</span></> },
          { key: 'excel', label: <>File Excel <span className="ml-1">📄</span></> },
          { key: 'crm', label: <>Thuộc tính khách hàng <span className="ml-1">🪪</span></> },
        ]} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'manual' && <ManualTab ensureSessionId={ensureSessionId} onAdded={onAdded} onClose={onClose}
            running={running} appendMode={appendMode} setAppendMode={setAppendMode} />}
          {tab === 'excel' && <ExcelTab ensureSessionId={ensureSessionId} onAdded={onAdded} onClose={onClose}
            running={running} appendMode={appendMode} setAppendMode={setAppendMode} />}
          {tab === 'crm' && <CrmTab ensureSessionId={ensureSessionId} onAdded={onAdded} onClose={onClose}
            running={running} appendMode={appendMode} setAppendMode={setAppendMode} />}
        </div>
      </div>
    </Drawer>
  );
}

interface TabProps {
  ensureSessionId: () => Promise<string>;
  onAdded: (r: { inserted: number; duplicated: number; invalid: number }) => void;
  onClose: () => void;
  running: boolean;
  appendMode: AppendMode;
  setAppendMode: (m: AppendMode) => void;
}

function AppendModePicker({ running, appendMode, setAppendMode }: Pick<TabProps, 'running' | 'appendMode' | 'setAppendMode'>) {
  if (!running) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-(--color-muted)">Phiên đang chạy:</span>
      <select className="rounded-lg border border-(--color-line) px-2 py-1.5 text-sm" value={appendMode}
        onChange={(e) => setAppendMode(e.target.value as AppendMode)}>
        <option value="RUN_AFTER">Chạy sau khi data cũ xong</option>
        <option value="RUN_NOW">Chạy ngay (chen hàng)</option>
      </select>
    </div>
  );
}

/* ============================== TAB THỦ CÔNG ============================== */

function ManualTab({ ensureSessionId, onAdded, onClose, running, appendMode, setAppendMode }: TabProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [staged, setStaged] = useState<StagedCustomer[]>([]);
  const [filter, setFilter] = useState('');
  const [countryCode, setCountryCode] = useState<CountryCodeOption>('Không áp dụng');
  const [customCode, setCustomCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) { setSuggestions([]); return; }
    debounce.current = setTimeout(async () => {
      try { setSuggestions(await get<ContactSuggestion[]>(`/api/contacts/search?q=${encodeURIComponent(query)}`)); }
      catch { setSuggestions([]); }
    }, 250);
  }, [query]);

  function stage(items: StagedCustomer[]) {
    setStaged((prev) => {
      const seen = new Set(prev.map((s) => s.phone));
      return [...prev, ...items.filter((i) => i.phone && !seen.has(i.phone))];
    });
    setQuery('');
    setSuggestions([]);
  }

  async function submit() {
    if (!staged.length) return;
    setBusy(true); setError(null);
    try {
      const sessionId = await ensureSessionId();
      const rows = staged.map((s) => ({
        phoneNumber: applyCountryCode(s.phone, countryCode, customCode),
        variables: { ...(s.variables ?? {}), ...(s.name && s.name !== 'Không xác định' ? { full_name: s.name } : {}) },
      }));
      const result = await post<{ inserted: number; duplicated: number; invalid: number }>(
        `/api/client-session/${sessionId}/data`, { rows, source: 'MANUAL', appendMode: running ? appendMode : undefined });
      onAdded(result);
      setStaged([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const visible = staged.filter((s) => !filter || s.phone.includes(filter) || s.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-(--color-line)">
        {/* Trái: nhập + autocomplete */}
        <div className="p-6">
          <h4 className="mb-3 text-[15px] font-bold">Thêm khách hàng</h4>
          <div className="relative">
            <div className="rounded-(--radius-field) border border-sky-200 bg-sky-50 px-4 py-2">
              <span className="block text-xs font-semibold text-(--color-link)">Thông tin cơ bản ▾</span>
              <input className={inputClass} placeholder="Số điện thoại, thông tin khách hàng" value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query.trim()) stage([{ name: 'Không xác định', phone: query.trim() }]);
                }} />
            </div>
            {suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-xl border border-(--color-line) bg-white p-2 shadow-lg">
                {suggestions.map((c) => (
                  <button key={c.id} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-50"
                    onClick={() => stage(c.phones.map((p) => ({ name: c.name, phone: p })))}>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100">👤</span>
                    <span>
                      <span className="block text-sm font-semibold">{c.name}</span>
                      <span className="block text-xs text-(--color-muted)">{c.phones.join(', ')}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="mt-3 w-full rounded-lg bg-(--color-primary) py-2.5 text-sm font-semibold text-white hover:bg-(--color-primary-dark) disabled:opacity-45"
            disabled={!query.trim()}
            onClick={() => stage([{ name: 'Không xác định', phone: query.trim() }])}>
            Thêm vào phiên gửi →
          </button>
          <p className="mt-2 text-xs text-(--color-muted)">Enter hoặc bấm nút để đưa số vào danh sách bên phải; chọn gợi ý để lấy toàn bộ số của khách.</p>
        </div>

        {/* Phải: danh sách thêm khả dụng */}
        <div className="flex min-h-0 flex-col p-6">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-[15px] font-bold">Danh sách thêm khả dụng ({staged.length})</h4>
            {staged.length > 0 && (
              <button className="text-sm text-(--color-link) hover:underline" onClick={() => setStaged([])}>Xóa tất cả</button>
            )}
          </div>
          <div className="mb-3 flex items-center gap-2 rounded-full bg-(--color-field) px-4 py-2">
            <span>🔍</span>
            <input className="w-full bg-transparent text-sm outline-none" placeholder={`Tìm kiếm | ${staged.length} khách hàng`}
              value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {visible.length === 0 && <p className="text-sm text-(--color-muted)">Không có dữ liệu</p>}
            {visible.map((s) => (
              <div key={s.phone} className="flex items-center justify-between rounded-xl bg-(--color-field) px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100">👤</span>
                  <div>
                    <div className="text-sm font-semibold">{s.name}</div>
                    <div className="text-xs text-(--color-muted)">{s.phone}</div>
                  </div>
                </div>
                <button className="text-(--color-danger)" onClick={() => setStaged(staged.filter((x) => x.phone !== s.phone))}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer: mã quốc gia + actions */}
      <div className="border-t border-(--color-line) px-6 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-(--color-muted)">Mã quốc gia</span>
          {COUNTRY_CODE_OPTIONS.map((opt) => (
            <button key={opt} onClick={() => setCountryCode(opt)}
              className={`rounded-full px-3 py-1 text-[13px] font-medium ${
                countryCode === opt ? 'bg-(--color-navy) text-white' : 'bg-(--color-field) hover:bg-gray-200'}`}>
              {opt}
            </button>
          ))}
          {countryCode === 'Tùy chỉnh' && (
            <input className="w-24 rounded-lg border border-(--color-line) px-2 py-1 text-sm" placeholder="+81"
              value={customCode} onChange={(e) => setCustomCode(e.target.value)} />
          )}
          <span className="ml-auto"><AppendModePicker running={running} appendMode={appendMode} setAppendMode={setAppendMode} /></span>
        </div>
        <div className="flex gap-3">
          <Button variant="primary" disabled={busy || staged.length === 0} onClick={submit}>
            {busy ? 'Đang thêm…' : `Thêm khách hàng${staged.length ? ` (${staged.length})` : ''}`}
          </Button>
          <Button onClick={onClose}>Đóng</Button>
          {error && <span className="self-center text-sm text-(--color-danger)">{error}</span>}
        </div>
      </div>
    </div>
  );
}

/* ============================== TAB FILE EXCEL ============================== */

const CSV_TEMPLATE = encodeURI('data:text/csv;charset=utf-8,phone_number,full_name,debt_amount\n0987000001,Nguyen Van A,1500000\n0912000002,Tran Thi B,2400000\n');

function ExcelTab({ ensureSessionId, onAdded, onClose, running, appendMode, setAppendMode }: TabProps) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportExcelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Real mode: BE parse nền → cần theo dõi batch chứ không có kết quả ngay. */
  const [pendingBatch, setPendingBatch] = useState<{ sessionId: string; batchId: string } | null>(null);
  const [progress, setProgress] = useState<ImportBatch | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true); setError(null); setResult(null); setPendingBatch(null);
    try {
      const sessionId = await ensureSessionId();
      const form = new FormData();
      form.append('file', file);
      if (running) form.append('appendMode', appendMode);
      // client CHỈ gửi FormData; BFF parse (mock) hoặc đẩy nguyên file xuống BE (real)
      const data = await api<ImportExcelResult>(`/api/client-session/${sessionId}/data/import-excel`, {
        method: 'POST', body: form, headers: undefined,
      });
      if (data.pending && data.importBatchId) {
        // Real mode: BE parse nền → theo dõi batch cho tới khi xong mới có số liệu
        setPendingBatch({ sessionId, batchId: data.importBatchId });
      } else {
        setResult(data);
        onAdded(data);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  }

  // Poll batch của lần upload này (không phải cả danh sách) cho tới DONE/FAILED
  useEffect(() => {
    if (!pendingBatch) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const batches = await get<ImportBatch[]>(`/api/client-session/${pendingBatch.sessionId}/jobs`);
        const batch = batches.find((b) => b.id === pendingBatch.batchId);
        if (!batch || stopped) return;
        setProgress(batch);
        if (batch.status === 'DONE' || batch.status === 'FAILED') {
          stopped = true;
          clearInterval(timer);
          setPendingBatch(null);
          if (batch.status === 'FAILED') {
            setError(batch.failReason || 'Import thất bại — xem chi tiết ở khu Xử lý nền');
          } else {
            setResult({
              fileName: file?.name ?? '',
              totalRows: batch.totalRows ?? 0,
              inserted: batch.inserted ?? 0,
              duplicated: batch.duplicated ?? 0,
              invalid: batch.invalid ?? 0,
              errors: [],
            });
            onAdded({ inserted: batch.inserted ?? 0, duplicated: batch.duplicated ?? 0, invalid: batch.invalid ?? 0 });
          }
        }
      } catch {
        /* mất 1 nhịp poll không sao — nhịp sau thử lại */
      }
    }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [pendingBatch, file, onAdded]);

  return (
    <div className="flex h-full flex-col p-6">
      <h4 className="mb-1 text-[15px] font-bold">Import từ file Excel</h4>
      <p className="mb-4 text-sm text-(--color-muted)">
        Cột đầu (hoặc cột có header chứa &quot;phone&quot;) = số điện thoại, các cột còn lại là biến của khách hàng.{' '}
        <a className="text-(--color-link) hover:underline" href={CSV_TEMPLATE} download="template-phien-goi.csv">Tải file mẫu</a>
      </p>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--color-line) bg-(--color-field) py-10 hover:border-(--color-primary)">
        <span className="text-3xl">📄</span>
        <span className="text-sm font-medium">{file ? file.name : 'Chọn file .xlsx / .csv (≤ 5MB — giới hạn demo)'}</span>
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
      </label>

      {pendingBatch && (
        <div className="mt-4 rounded-xl border border-(--color-line) bg-(--color-field) p-4 text-sm">
          <div className="font-semibold">Đang xử lý trên server…</div>
          <div className="mt-1 text-xs text-(--color-muted)">
            File lớn được đọc theo luồng nên có thể mất vài phút. Bạn có thể đóng cửa sổ này —
            tiến độ vẫn theo dõi được ở khu <b>Xử lý nền</b> của phiên.
          </div>
          {progress && (
            <div className="mt-2 text-xs">
              Đã xử lý {(progress.processedRows ?? 0).toLocaleString('vi-VN')} dòng
              {(progress.totalRows ?? 0) > 0 && ` / ${(progress.totalRows ?? 0).toLocaleString('vi-VN')}`}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-(--color-line) p-4 text-sm">
          <div className="mb-1 font-semibold">{result.fileName} — {result.totalRows} dòng</div>
          <div className="flex gap-4">
            <span className="text-green-700">✓ Thêm mới: {result.inserted}</span>
            <span className="text-amber-700">Trùng: {result.duplicated}</span>
            <span className="text-red-700">Không hợp lệ: {result.invalid}</span>
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-xs text-(--color-danger)">
              {result.errors.map((e, i) => <li key={i}>Dòng {e.row}: {e.reason}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-(--color-line) pt-4">
        <Button variant="primary" disabled={!file || busy || !!pendingBatch} onClick={upload}>
          {busy ? 'Đang tải lên…' : pendingBatch ? 'Server đang xử lý…' : 'Tải lên & thêm vào phiên'}
        </Button>
        <Button onClick={onClose}>Đóng</Button>
        <AppendModePicker running={running} appendMode={appendMode} setAppendMode={setAppendMode} />
        {error && <span className="text-sm text-(--color-danger)">{error}</span>}
      </div>
    </div>
  );
}

/* ====================== TAB THUỘC TÍNH KHÁCH HÀNG (CRM) ====================== */

/** Bộ lọc BE hỗ trợ (B6). Chưa có API danh mục tag/nhóm nên nhập ID, phân cách bằng dấu phẩy. */
const CRM_FILTER_FIELDS = [
  { key: 'tagIds' as const, label: 'Tag', placeholder: 'tag_vip, tag_moi' },
  { key: 'categoryIds' as const, label: 'Nhóm khách hàng', placeholder: 'cat_1, cat_2' },
  { key: 'businessIds' as const, label: 'Loại hình', placeholder: 'biz_1' },
  { key: 'userOwnerIds' as const, label: 'Người phụ trách', placeholder: 'user_1' },
];

function CrmTab({ ensureSessionId, onAdded, onClose, running, appendMode, setAppendMode }: TabProps) {
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enqueued, setEnqueued] = useState(false);

  function buildFilter(): CrmContactFilter {
    const filter: CrmContactFilter = {};
    for (const field of CRM_FILTER_FIELDS) {
      const ids = (raw[field.key] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) filter[field.key] = ids;
    }
    if (dateFrom) filter.createdFromMs = new Date(dateFrom).getTime();
    // đến hết ngày đã chọn, không phải 00:00 của ngày đó
    if (dateTo) filter.createdToMs = new Date(dateTo).getTime() + 86_399_999;
    return filter;
  }

  async function preview() {
    setBusy(true); setError(null); setEnqueued(false);
    try {
      const sessionId = await ensureSessionId();
      const data = await post<{ estimatedCount: number }>(
        `/api/client-session/${sessionId}/jobs`, { action: 'preview-crm', filter: buildFilter() });
      setCount(data.estimatedCount);
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function importCrm() {
    setBusy(true); setError(null);
    try {
      const sessionId = await ensureSessionId();
      await post<ImportBatch>(`/api/client-session/${sessionId}/jobs`, {
        action: 'import-crm', filter: buildFilter(), appendMode: running ? appendMode : undefined,
      });
      setEnqueued(true);
      onAdded({ inserted: 0, duplicated: 0, invalid: 0 }); // để màn cha reload; số thật lấy từ batch
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex h-full flex-col p-6">
      <h4 className="mb-1 text-[15px] font-bold">Lấy từ thuộc tính khách hàng (CRM)</h4>
      <p className="mb-4 text-sm text-(--color-muted)">
        Data được CHỤP tại thời điểm nạp (snapshot) — khách hàng đổi thông tin sau đó không ảnh hưởng phiên.
        Chỉ những biến kịch bản đang cần được lấy sang, không bê cả hồ sơ khách hàng.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {CRM_FILTER_FIELDS.map((field) => (
          <label key={field.key} className="text-sm">
            <span className="mb-1 block text-xs text-(--color-muted)">{field.label}</span>
            <input className="w-full rounded-lg border border-(--color-line) bg-(--color-field) px-3 py-2 outline-none"
              placeholder={field.placeholder}
              value={raw[field.key] ?? ''}
              onChange={(e) => { setRaw({ ...raw, [field.key]: e.target.value }); setCount(null); }} />
          </label>
        ))}
        <label className="text-sm">
          <span className="mb-1 block text-xs text-(--color-muted)">Ngày tạo từ</span>
          <input type="date" className="w-full rounded-lg border border-(--color-line) bg-(--color-field) px-3 py-2 outline-none"
            value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setCount(null); }} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-(--color-muted)">đến</span>
          <input type="date" className="w-full rounded-lg border border-(--color-line) bg-(--color-field) px-3 py-2 outline-none"
            value={dateTo} onChange={(e) => { setDateTo(e.target.value); setCount(null); }} />
        </label>
      </div>

      <p className="mt-3 text-xs text-(--color-muted)">
        Để trống tất cả = lấy toàn bộ danh bạ. Chưa có API danh mục tag/nhóm nên tạm nhập ID
        (lấy từ màn Danh bạ của OmiCRM); khi BE mở API danh mục sẽ đổi thành dropdown.
      </p>

      {count != null && (
        <div className="mt-4 rounded-xl border border-(--color-line) bg-(--color-field) px-4 py-3 text-sm">
          Khớp <b>{count.toLocaleString('vi-VN')}</b> khách hàng.
          {count > 0 && ' Bấm "Nạp vào phiên" để chạy — việc nạp chạy nền, theo dõi ở khu Xử lý nền.'}
        </div>
      )}

      {enqueued && (
        <div className="mt-3 rounded-xl border border-(--color-primary) bg-(--color-primary-soft) px-4 py-3 text-sm">
          Đã xếp hàng nạp danh bạ. Tiến độ và kết quả xem ở khu <b>Xử lý nền</b> của phiên.
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-(--color-line) pt-4">
        <Button onClick={preview} disabled={busy}>{busy ? 'Đang đếm…' : 'Xem trước số lượng'}</Button>
        <Button variant="primary" disabled={busy || !count} onClick={importCrm}>
          Nạp {count ? count.toLocaleString('vi-VN') : ''} khách hàng vào phiên
        </Button>
        <Button onClick={onClose}>Đóng</Button>
        <AppendModePicker running={running} appendMode={appendMode} setAppendMode={setAppendMode} />
        {error && <span className="text-sm text-(--color-danger)">{error}</span>}
      </div>
    </div>
  );
}
