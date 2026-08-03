'use client';
/**
 * Field kịch bản + đầu số: cho phép NHẬP GIÁ TRỊ THẬT khi app không tự lấy được danh mục.
 *
 * Kịch bản (`scriptUuid`) và đầu số là dữ liệu của tenant trên backend; app chưa có API danh mục
 * nên giá trị mock sẵn có sẽ bị backend từ chối (`CS_SCRIPT_NOT_FOUND`) hoặc gọi ra số không tồn tại.
 * Ở real mode, UI vì thế: (1) đánh dấu rõ giá trị nào là mock, (2) cảnh báo khi đang chọn mock,
 * (3) cho nhập giá trị thật và ghi nhớ trong localStorage để nhập một lần dùng mãi.
 */
import { useState } from 'react';
import type { SipNumber } from '@/contracts/types';
import { IS_REAL } from '@/lib/sessionApi';
import {
  addScript, addSipNumber, removeScript, removeSipNumber, useCatalogOverrides, type ScriptOption,
} from '@/lib/catalogOverrides';
import { SCRIPTS, SIP_NUMBERS } from './catalogs';
import { Button, Field, inputClass } from '../ui';

const MOCK_HINT = 'mock — backend thật không có giá trị này';

/* ============================== Kịch bản ============================== */

export function ScriptField({ value, onChange }: { value: string; onChange: (uuid: string) => void }) {
  const overrides = useCatalogOverrides();
  const [adding, setAdding] = useState(false);
  const [uuid, setUuid] = useState('');
  const [name, setName] = useState('');

  const isMockSelected = SCRIPTS.some((s) => s.uuid === value)
    && !overrides.scripts.some((s) => s.uuid === value);

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
          {!value && <option value="">— Chọn kịch bản —</option>}
          {overrides.scripts.length > 0 && (
            <optgroup label="Kịch bản thật (bạn đã nhập)">
              {overrides.scripts.map((s) => <option key={s.uuid} value={s.uuid}>{s.name}</option>)}
            </optgroup>
          )}
          <optgroup label={IS_REAL ? `Mẫu demo (${MOCK_HINT})` : 'Kịch bản demo'}>
            {SCRIPTS.map((s) => (
              <option key={s.uuid} value={s.uuid}>{s.name}{IS_REAL ? ' — mock' : ''}</option>
            ))}
          </optgroup>
        </select>
        <Button onClick={() => setAdding((v) => !v)}
          title="Dán UUID kịch bản thật lấy từ màn Kịch bản của OmiCRM">
          {adding ? 'Đóng' : '＋ Nhập UUID thật'}
        </Button>
      </div>

      {adding && (
        <div className="mt-2 rounded-xl border border-(--color-line) bg-(--color-field) p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputClass} placeholder="scriptUuid (bắt buộc)" value={uuid}
              onChange={(e) => setUuid(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()} />
            <input className={inputClass} placeholder="Tên gợi nhớ (tuỳ chọn)" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button variant="primary" onClick={save} disabled={!uuid.trim()}>Lưu &amp; chọn</Button>
            <span className="text-xs text-(--color-muted)">
              Lấy UUID ở màn Kịch bản của OmiCRM. Lưu trên máy này, nhập một lần dùng mãi.
            </span>
          </div>
        </div>
      )}

      {overrides.scripts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {overrides.scripts.map((s) => (
            <SavedChip key={s.uuid} label={s.name} onRemove={() => removeScript(s.uuid)} />
          ))}
        </div>
      )}

      {IS_REAL && isMockSelected && (
        <Warning>
          Đang chọn kịch bản <b>mock</b>. Backend thật sẽ trả <code>CS_SCRIPT_NOT_FOUND</code> khi tạo phiên —
          bấm <b>＋ Nhập UUID thật</b> để dán UUID kịch bản của doanh nghiệp.
        </Warning>
      )}
    </Field>
  );
}

/* ============================== Đầu số ============================== */

export function SipNumbersField({
  value, onChange,
}: { value: SipNumber[]; onChange: (next: SipNumber[]) => void }) {
  const overrides = useCatalogOverrides();
  const [adding, setAdding] = useState(false);
  const [number, setNumber] = useState('');
  const [network, setNetwork] = useState('');
  const [gateway, setGateway] = useState('');

  const all: Array<SipNumber & { mock?: boolean }> = [
    ...overrides.sipNumbers,
    ...SIP_NUMBERS.filter((m) => !overrides.sipNumbers.some((o) => o.number === m.number))
      .map((m) => ({ ...m, mock: true })),
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
        {all.map((sip) => {
          const selected = value.some((s) => s.number === sip.number);
          return (
            <button key={sip.number} type="button" onClick={() => toggle(sip)}
              title={sip.mock && IS_REAL ? MOCK_HINT : undefined}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                selected
                  ? 'border-(--color-primary) bg-(--color-primary-soft) text-(--color-primary-dark)'
                  : 'border-(--color-line) bg-white'} ${sip.mock && IS_REAL ? 'opacity-60' : ''}`}>
              {sip.number}
              <span className="ml-1 text-xs text-(--color-muted)">
                ({sip.network || 'chưa rõ mạng'}{sip.mock && IS_REAL ? ' · mock' : ''})
              </span>
            </button>
          );
        })}
        <Button onClick={() => setAdding((v) => !v)} title="Nhập đầu số thật của doanh nghiệp">
          {adding ? 'Đóng' : '＋ Thêm đầu số thật'}
        </Button>
      </div>

      {adding && (
        <div className="mt-2 rounded-xl border border-(--color-line) bg-(--color-field) p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <input className={inputClass} placeholder="Số (vd 842873001234)" value={number}
              onChange={(e) => setNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <input className={inputClass} placeholder="Nhà mạng (viettel/vnpt…)" value={network}
              onChange={(e) => setNetwork(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <input className={inputClass} placeholder="Gateway (tuỳ chọn)" value={gateway}
              onChange={(e) => setGateway(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button variant="primary" onClick={save} disabled={!number.trim()}>Lưu &amp; chọn</Button>
            <span className="text-xs text-(--color-muted)">
              Nhà mạng dùng để phân bổ cuộc gọi; để trống vẫn gọi được nhưng phân bổ kém chính xác.
            </span>
          </div>
        </div>
      )}

      {overrides.sipNumbers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {overrides.sipNumbers.map((s) => (
            <SavedChip key={s.number} label={s.number} onRemove={() => removeSipNumber(s.number)} />
          ))}
        </div>
      )}

      {IS_REAL && hasMockSelected && (
        <Warning>
          Đang chọn đầu số <b>mock</b> — số này không thuộc doanh nghiệp nên cuộc gọi sẽ lỗi ở tổng đài.
          Bấm <b>＋ Thêm đầu số thật</b> rồi bỏ chọn số mock.
        </Warning>
      )}
    </Field>
  );
}

/** Tên hiển thị của kịch bản: tra cả danh sách user tự nhập lẫn mẫu demo. */
export function scriptLabel(uuid: string, saved: ScriptOption[]): string | undefined {
  if (!uuid) return undefined;
  return saved.find((s) => s.uuid === uuid)?.name
    ?? SCRIPTS.find((s) => s.uuid === uuid)?.name
    ?? uuid;
}

/* ============================== dùng chung ============================== */

function SavedChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-(--color-primary-soft) px-2.5 py-0.5 text-xs text-(--color-primary-dark)">
      đã lưu: {label}
      <button type="button" className="hover:opacity-60" title="Xoá khỏi danh sách đã lưu"
        onClick={onRemove}>×</button>
    </span>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
      ⚠️ {children}
    </div>
  );
}
