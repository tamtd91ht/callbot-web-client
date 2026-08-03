'use client';
/**
 * Field kịch bản / đầu số / giọng đọc.
 *
 * Real mode lấy danh mục THẬT từ 3 gateway OmiCRM (xem `lib/catalogApi.ts`). Nhưng 3 API đó nằm ở
 * service khác nên có thể 401/500 độc lập với callbot-service — khi đó UI vẫn cho **nhập tay**
 * giá trị thật (lưu localStorage, nhập một lần dùng mãi) để không bị chặn cứng.
 * Giá trị mock được đánh dấu rõ và có cảnh báo, vì backend thật sẽ từ chối chúng.
 */
import { useState } from 'react';
import type { SipNumber } from '@/contracts/types';
import { IS_REAL } from '@/lib/sessionApi';
import {
  addScript, addSipNumber, addVoice, removeScript, removeSipNumber, removeVoice,
  useCatalogOverrides, type ScriptOption,
} from '@/lib/catalogOverrides';
import type { CatalogState } from '@/lib/useCatalogs';
import { SCRIPTS, SIP_NUMBERS, VOICES } from './catalogs';
import { Button, Field, inputClass } from '../ui';

const MOCK_SUFFIX = ' — mock';

/* ============================== Kịch bản ============================== */

export function ScriptField({
  value, onChange, catalogs,
}: { value: string; onChange: (uuid: string) => void; catalogs: CatalogState }) {
  const overrides = useCatalogOverrides();
  const [adding, setAdding] = useState(false);
  const [uuid, setUuid] = useState('');
  const [name, setName] = useState('');

  const real = catalogs.scripts;
  const showMock = !IS_REAL || real.length === 0;
  const isMockSelected = IS_REAL && SCRIPTS.some((s) => s.uuid === value)
    && !real.some((s) => s.uuid === value);

  function save() {
    const trimmed = uuid.trim();
    if (!trimmed) return;
    addScript({ uuid: trimmed, name: name.trim() || trimmed });
    onChange(trimmed);
    setUuid(''); setName(''); setAdding(false);
  }

  return (
    <Field label="Kịch bản AI Callbot" required>
      <div className="flex items-center gap-2">
        <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          {!value && <option value="">{catalogs.loading ? 'Đang tải kịch bản…' : '— Chọn kịch bản —'}</option>}
          {real.length > 0 && (
            <optgroup label={catalogs.fromApi.scripts ? 'Kịch bản của doanh nghiệp' : 'Kịch bản bạn đã nhập'}>
              {real.map((s) => <option key={s.uuid} value={s.uuid}>{s.name}</option>)}
            </optgroup>
          )}
          {showMock && (
            <optgroup label={IS_REAL ? 'Mẫu demo (backend thật không có)' : 'Kịch bản demo'}>
              {SCRIPTS.map((s) => (
                <option key={s.uuid} value={s.uuid}>{s.name}{IS_REAL ? MOCK_SUFFIX : ''}</option>
              ))}
            </optgroup>
          )}
        </select>
        <Button onClick={() => setAdding((v) => !v)} title="Dán UUID kịch bản thật nếu API danh mục không lấy được">
          {adding ? 'Đóng' : '＋ UUID'}
        </Button>
      </div>

      {adding && (
        <AddBox onSave={save} canSave={!!uuid.trim()}
          hint="Lấy UUID ở màn Kịch bản của OmiCRM. Lưu trên máy này, nhập một lần dùng mãi.">
          <input className={inputClass} placeholder="scriptUuid (bắt buộc)" value={uuid}
            onChange={(e) => setUuid(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <input className={inputClass} placeholder="Tên gợi nhớ (tuỳ chọn)" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </AddBox>
      )}

      <SavedChips items={overrides.scripts.map((s) => ({ key: s.uuid, label: s.name }))}
        onRemove={removeScript} />
      <CatalogError message={catalogs.errors.scripts} onRetry={catalogs.reload} />

      {isMockSelected && (
        <Warning>
          Đang chọn kịch bản <b>mock</b> — backend sẽ trả <code>CS_SCRIPT_NOT_FOUND</code>.
          Chọn kịch bản của doanh nghiệp, hoặc bấm <b>＋ UUID</b> để dán tay.
        </Warning>
      )}
    </Field>
  );
}

/* ============================== Đầu số ============================== */

export function SipNumbersField({
  value, onChange, catalogs,
}: { value: SipNumber[]; onChange: (next: SipNumber[]) => void; catalogs: CatalogState }) {
  const overrides = useCatalogOverrides();
  const [adding, setAdding] = useState(false);
  const [number, setNumber] = useState('');
  const [network, setNetwork] = useState('');
  const [gateway, setGateway] = useState('');

  const real = catalogs.sipNumbers;
  const showMock = !IS_REAL || real.length === 0;
  const all: Array<SipNumber & { mock?: boolean }> = [
    ...real,
    ...(showMock
      ? SIP_NUMBERS.filter((m) => !real.some((r) => r.number === m.number)).map((m) => ({ ...m, mock: IS_REAL }))
      : []),
  ];
  const hasMockSelected = value.some((v) => all.find((a) => a.number === v.number)?.mock);

  function toggle(sip: SipNumber) {
    const selected = value.some((s) => s.number === sip.number);
    onChange(selected ? value.filter((s) => s.number !== sip.number) : [...value, sip]);
  }

  function save() {
    const trimmed = number.trim();
    if (!trimmed) return;
    const sip: SipNumber = {
      number: trimmed,
      network: network.trim() || undefined,
      gateway: gateway.trim() || undefined,
    };
    addSipNumber(sip);
    onChange([...value.filter((s) => s.number !== trimmed), sip]);
    setNumber(''); setNetwork(''); setGateway(''); setAdding(false);
  }

  return (
    <Field label="Đầu số (chọn nhiều — phân bổ theo nhà mạng)" required highlight>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {catalogs.loading && all.length === 0 && (
          <span className="text-sm text-(--color-muted)">Đang tải đầu số…</span>
        )}
        {all.map((sip) => {
          const selected = value.some((s) => s.number === sip.number);
          return (
            <button key={sip.number} type="button" onClick={() => toggle(sip)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                selected
                  ? 'border-(--color-primary) bg-(--color-primary-soft) text-(--color-primary-dark)'
                  : 'border-(--color-line) bg-white'} ${sip.mock ? 'opacity-60' : ''}`}>
              {sip.number}
              <span className="ml-1 text-xs text-(--color-muted)">
                ({sip.network || 'chưa rõ mạng'}{sip.mock ? ' · mock' : ''})
              </span>
            </button>
          );
        })}
        <Button onClick={() => setAdding((v) => !v)} title="Nhập đầu số thật nếu API danh mục không lấy được">
          {adding ? 'Đóng' : '＋ Đầu số'}
        </Button>
      </div>

      {adding && (
        <AddBox onSave={save} canSave={!!number.trim()}
          hint="Nhà mạng dùng để phân bổ cuộc gọi; để trống vẫn gọi được nhưng phân bổ kém chính xác."
          columns={3}>
          <input className={inputClass} placeholder="Số (vd 842873001234)" value={number}
            onChange={(e) => setNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <input className={inputClass} placeholder="Nhà mạng (viettel/vnpt…)" value={network}
            onChange={(e) => setNetwork(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <input className={inputClass} placeholder="Gateway (tuỳ chọn)" value={gateway}
            onChange={(e) => setGateway(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </AddBox>
      )}

      <SavedChips items={overrides.sipNumbers.map((s) => ({ key: s.number, label: s.number }))}
        onRemove={removeSipNumber} />
      <CatalogError message={catalogs.errors.sipNumbers} onRetry={catalogs.reload} />

      {hasMockSelected && (
        <Warning>
          Đang chọn đầu số <b>mock</b> — số này không thuộc doanh nghiệp nên cuộc gọi sẽ lỗi ở tổng đài.
        </Warning>
      )}
    </Field>
  );
}

/* ============================== Giọng đọc ============================== */

export function VoiceField({
  value, onChange, catalogs,
}: { value: string; onChange: (voice: string) => void; catalogs: CatalogState }) {
  const overrides = useCatalogOverrides();
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState('');

  // Danh sách enum trong catalogs.ts là enum THẬT của BE (copy từ Voice.java) nên luôn dùng được;
  // API bot-accent chỉ để lấy đúng tập giọng tenant được phép + nhãn hiển thị.
  const options = catalogs.voices.length > 0 ? catalogs.voices : VOICES.filter((v) => v.value);

  function save() {
    const trimmed = custom.trim();
    if (!trimmed) return;
    addVoice(trimmed);
    onChange(trimmed);
    setCustom(''); setAdding(false);
  }

  return (
    <Field label="Giọng đọc (ưu tiên hơn giọng trong kịch bản)">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--color-navy) text-xs text-white">▶</span>
        <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Theo kịch bản (không override)</option>
          {options.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        <Button onClick={() => setAdding((v) => !v)} title="Nhập tên enum Voice của backend">
          {adding ? 'Đóng' : '＋'}
        </Button>
      </div>

      {adding && (
        <AddBox onSave={save} canSave={!!custom.trim()}
          hint="Phải KHỚP tên enum Voice của backend (vd northern_female_ngocanh). Sai tên thì backend bỏ qua toàn bộ cấu hình gọi, mất luôn đầu số.">
          <input className={inputClass} placeholder="vd northern_female_ngocanh" value={custom}
            onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </AddBox>
      )}

      <SavedChips items={overrides.voices.map((v) => ({ key: v, label: v }))} onRemove={removeVoice} />
      <CatalogError message={catalogs.errors.voices} onRetry={catalogs.reload} />
    </Field>
  );
}

/* ============================== dùng chung ============================== */

/** Tên hiển thị của kịch bản: tra cả danh mục thật, giá trị user nhập, lẫn mẫu demo. */
export function scriptLabel(uuid: string, known: ScriptOption[]): string | undefined {
  if (!uuid) return undefined;
  return known.find((s) => s.uuid === uuid)?.name
    ?? SCRIPTS.find((s) => s.uuid === uuid)?.name
    ?? uuid;
}

function AddBox({
  children, onSave, canSave, hint, columns = 2,
}: {
  children: React.ReactNode; onSave: () => void; canSave: boolean; hint: string; columns?: number;
}) {
  return (
    <div className="mt-2 rounded-xl border border-(--color-line) bg-(--color-field) p-3">
      <div className={`grid gap-2 ${columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="primary" onClick={onSave} disabled={!canSave}>Lưu &amp; chọn</Button>
        <span className="text-xs text-(--color-muted)">{hint}</span>
      </div>
    </div>
  );
}

function SavedChips({
  items, onRemove,
}: { items: Array<{ key: string; label: string }>; onRemove: (key: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item.key}
          className="inline-flex items-center gap-1 rounded-full bg-(--color-primary-soft) px-2.5 py-0.5 text-xs text-(--color-primary-dark)">
          đã lưu: {item.label}
          <button type="button" className="hover:opacity-60" title="Xoá khỏi danh sách đã lưu"
            onClick={() => onRemove(item.key)}>×</button>
        </span>
      ))}
    </div>
  );
}

/** Lỗi lấy danh mục KHÔNG chặn tạo phiên — chỉ báo rõ và cho nhập tay/thử lại. */
function CatalogError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  if (!message) return null;
  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
      <span className="min-w-0 flex-1 break-words">Không lấy được danh mục — {message}</span>
      <button type="button" className="shrink-0 underline hover:opacity-70" onClick={onRetry}>Thử lại</button>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">⚠️ {children}</div>;
}
