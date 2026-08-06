'use client';
/**
 * Field kịch bản / đầu số / giọng đọc.
 *
 * Real mode: danh mục lấy DUY NHẤT từ 3 gateway OmiCRM (xem `lib/catalogApi.ts`) — không còn
 * đường nhập tay. API lỗi thì hiện lỗi + nút thử lại, vì giá trị gõ tay sai (scriptUuid không
 * tồn tại, số không thuộc doanh nghiệp) chỉ đẩy lỗi xuống lúc submit/gọi, khó lần hơn nhiều.
 * Mock mode: dùng danh mục demo trong `catalogs.ts`.
 */
import { useEffect, useRef, useState } from 'react';
import type { SipNumber } from '@/contracts/types';
import type { ScriptOption } from '@/lib/catalogApi';
import { IS_REAL } from '@/lib/sessionApi';
import type { CatalogState } from '@/lib/useCatalogs';
import { PURPOSES, SCRIPTS, SIP_NUMBERS, VOICES } from './catalogs';
import { Field, inputClass } from '../ui';

/* ============================== Kịch bản ============================== */

export function ScriptField({
  value, onChange, catalogs, error, fieldRef, onViewDetail,
}: {
  value: string;
  onChange: (uuid: string) => void;
  catalogs: CatalogState;
  /** Lỗi validate — hiện ngay trên nhãn field như AutoCall (errors.script). */
  error?: string;
  fieldRef?: React.Ref<HTMLSelectElement>;
  onViewDetail?: () => void;
}) {
  const options = IS_REAL ? catalogs.scripts : SCRIPTS;
  const selected = options.find((s) => s.uuid === value);

  return (
    <Field label={error || 'Kịch bản AI Callbot'} required invalid={!!error}>
      <div className="flex items-center gap-2">
        <select ref={fieldRef} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          {!value && <option value="">{catalogs.loading ? 'Đang tải kịch bản…' : '— Chọn kịch bản —'}</option>}
          {options.map((s) => <option key={s.uuid} value={s.uuid}>{s.name}</option>)}
        </select>
        {/* AutoCall có link "Xem chi tiết" mở drawer kịch bản — giữ hành vi đó */}
        <button type="button" disabled={!value}
          onClick={(e) => { e.preventDefault(); onViewDetail?.(); }}
          className="shrink-0 text-sm font-semibold text-(--color-link) hover:underline disabled:opacity-40 disabled:hover:no-underline">
          Xem chi tiết
        </button>
      </div>

      {/* Tối ưu so với AutoCall: hiện luôn biến kịch bản cần nạp (CallBot chỉ 1 kịch bản nên có chỗ) */}
      {selected?.variables && selected.variables.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-(--color-muted)">Biến cần nạp:</span>
          {selected.variables.map((variable) => (
            <code key={variable.fieldCode} title={variable.fieldName || variable.fieldCode}
              className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-(--color-ink) ring-1 ring-(--color-line)">
              {variable.fieldCode}
            </code>
          ))}
        </div>
      )}

      <CatalogEmpty show={IS_REAL && !catalogs.loading && options.length === 0 && !catalogs.errors.scripts}
        label="kịch bản" hint="Tạo kịch bản ở màn AI Callbot của OmiCRM rồi bấm thử lại." onRetry={catalogs.reload} />
      <CatalogError message={catalogs.errors.scripts} onRetry={catalogs.reload} />
    </Field>
  );
}

/* ============================== Đầu số ============================== */

/**
 * Đầu số: dropdown như mockup — field mặc định TRỐNG, click mới trỏ xuống danh sách khả thi;
 * chọn 1 hoặc nhiều đều được (quyết định owner 2026-08-04). Chọn/bỏ trong dropdown hoặc bấm ×
 * trên chip đã chọn.
 */
export function SipNumbersField({
  value, onChange, catalogs, error, anchorRef,
}: {
  value: SipNumber[];
  onChange: (next: SipNumber[]) => void;
  catalogs: CatalogState;
  error?: string;
  anchorRef?: React.Ref<HTMLDivElement>;
}) {
  const options = IS_REAL ? catalogs.sipNumbers : SIP_NUMBERS;
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // click ra ngoài thì đóng dropdown
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function toggle(sip: SipNumber) {
    const selected = value.some((s) => s.number === sip.number);
    onChange(selected ? value.filter((s) => s.number !== sip.number) : [...value, sip]);
  }

  // anchorRef (do màn ngoài truyền vào để scroll tới khi lỗi) và boxRef (click-outside) cùng trỏ
  // một node — gộp lại thay vì chọn một trong hai, nếu không thì mất tính năng còn lại.
  const attachBox = (node: HTMLDivElement | null) => {
    boxRef.current = node;
    if (typeof anchorRef === 'function') anchorRef(node);
    else if (anchorRef) (anchorRef as React.RefObject<HTMLDivElement | null>).current = node;
  };

  return (
    <Field label={error || 'Đầu số (chọn 1 hoặc nhiều — phân bổ theo nhà mạng)'}
      required highlight invalid={!!error}>
      <div className="relative" ref={attachBox}>
        {/* preventDefault BẮT BUỘC: Field bọc trong <label> — không chặn thì browser forward click
            tới labelable element đầu tiên bên trong (nút option/nút × chip) → tự chọn số ngoài ý muốn */}
        <div role="button" tabIndex={0} aria-expanded={open}
          onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
          className={`${inputClass} flex min-h-10 cursor-pointer items-center gap-2`}>
          {value.length === 0 ? (
            <span className="text-(--color-muted)">
              {catalogs.loading && options.length === 0 ? 'Đang tải đầu số…' : '— Chọn đầu số —'}
            </span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {value.map((sip) => (
                <span key={sip.number}
                  className="inline-flex items-center gap-1 rounded-lg bg-(--color-primary-soft) px-2 py-0.5 text-sm font-medium text-(--color-primary-dark)">
                  {sip.number}
                  <button type="button" title="Bỏ chọn" className="hover:opacity-60"
                    onClick={(e) => { e.stopPropagation(); toggle(sip); }}>×</button>
                </span>
              ))}
            </span>
          )}
          <span className="ml-auto text-xs text-(--color-muted)">▾</span>
        </div>

        {open && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-(--color-line) bg-white shadow-lg">
            {options.length === 0 && (
              <div className="px-3 py-2.5 text-sm text-(--color-muted)">
                {catalogs.loading ? 'Đang tải đầu số…' : 'Không có đầu số khả dụng'}
              </div>
            )}
            {options.map((sip) => {
              const selected = value.some((s) => s.number === sip.number);
              return (
                <button key={sip.number} type="button" onClick={() => toggle(sip)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-(--color-field)">
                  <span aria-hidden
                    className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border text-[11px] ${
                      selected
                        ? 'border-(--color-primary) bg-(--color-primary) text-white'
                        : 'border-(--color-line) bg-white text-transparent'}`}>✓</span>
                  <span className="font-medium">{sip.number}</span>
                  <span className="text-xs text-(--color-muted)">({sip.network || 'chưa rõ mạng'})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <CatalogEmpty show={IS_REAL && !catalogs.loading && options.length === 0 && !catalogs.errors.sipNumbers}
        label="đầu số" hint="Doanh nghiệp chưa có đầu số active nào — liên hệ quản trị viên." onRetry={catalogs.reload} />
      <CatalogError message={catalogs.errors.sipNumbers} onRetry={catalogs.reload} />
    </Field>
  );
}

/* ============================== Giọng đọc ============================== */

export function VoiceField({
  value, onChange, catalogs,
}: { value: string; onChange: (voice: string) => void; catalogs: CatalogState }) {
  // Enum trong catalogs.ts là enum Voice THẬT của BE (copy từ Voice.java) nên là fallback an toàn;
  // API bot-accent chỉ để lấy đúng tập giọng tenant được phép + nhãn hiển thị.
  const options = catalogs.voices.length > 0 ? catalogs.voices : VOICES.filter((v) => v.value);

  return (
    <Field label="Giọng đọc (ưu tiên hơn giọng trong kịch bản)">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--color-navy) text-xs text-white">▶</span>
        <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Theo kịch bản (không override)</option>
          {options.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </div>
      <CatalogError message={catalogs.errors.voices} onRetry={catalogs.reload} />
    </Field>
  );
}

/* ============================== Mục đích cuộc gọi ============================== */

/**
 * Mục đích cuộc gọi — danh mục do doanh nghiệp tự định nghĩa (service CDR), KHÔNG hardcode.
 * BE callbot lưu `purpose` là chuỗi tự do nên ta gửi TÊN mục đích; app OMICRM thật gửi cả
 * id + name, nhưng client-session không có field id nên tên là đủ và đọc được ở báo cáo.
 * Không bắt buộc — app thật cũng cho để trống ("Không áp dụng").
 */
export function PurposeField({
  value, onChange, catalogs,
}: { value: string; onChange: (purpose: string) => void; catalogs: CatalogState }) {
  const options = IS_REAL ? catalogs.callPurposes.map((p) => p.name) : PURPOSES;

  return (
    <Field label="Mục đích cuộc gọi">
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">
          {IS_REAL && catalogs.loading && options.length === 0 ? 'Đang tải…' : 'Không áp dụng'}
        </option>
        {options.map((name) => <option key={name} value={name}>{name}</option>)}
        {/* giữ giá trị cũ của phiên nháp dù danh mục đã đổi/xoá — không âm thầm mất dữ liệu */}
        {value && !options.includes(value) && <option value={value}>{value} (không còn trong danh mục)</option>}
      </select>
      <CatalogError message={catalogs.errors.callPurposes} onRetry={catalogs.reload} />
    </Field>
  );
}

/* ============================== dùng chung ============================== */

/** Tên hiển thị của kịch bản: tra danh mục thật rồi tới mẫu demo (mock mode). */
export function scriptLabel(uuid: string, known: ScriptOption[]): string | undefined {
  if (!uuid) return undefined;
  return known.find((s) => s.uuid === uuid)?.name
    ?? SCRIPTS.find((s) => s.uuid === uuid)?.name
    ?? uuid;
}

/** API trả về danh sách rỗng — không phải lỗi kỹ thuật, nhưng user cần biết vì sao không có gì để chọn. */
function CatalogEmpty({ show, label, hint, onRetry }: {
  show: boolean; label: string; hint: string; onRetry: () => void;
}) {
  if (!show) return null;
  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <span className="min-w-0 flex-1">Doanh nghiệp chưa có {label} nào. {hint}</span>
      <button type="button" className="shrink-0 underline hover:opacity-70" onClick={onRetry}>Thử lại</button>
    </div>
  );
}

/** Lỗi lấy danh mục — real mode không còn đường nhập tay nên phải hiện rõ và cho thử lại. */
function CatalogError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  if (!message) return null;
  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
      <span className="min-w-0 flex-1 break-words">Không lấy được danh mục — {message}</span>
      <button type="button" className="shrink-0 underline hover:opacity-70" onClick={onRetry}>Thử lại</button>
    </div>
  );
}
