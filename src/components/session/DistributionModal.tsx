'use client';
/**
 * Modal "Thay đổi" của card phân bổ (template img.png):
 * batchSize + batchIntervalSeconds (phân bổ), timeSlots (khung giờ), retryConfig (gọi lại).
 */
import { useState } from 'react';
import type { RetryConfig, TimeSlot } from '@/contracts/types';
import { Button, Field, Modal, inputClass } from '../ui';

export interface DistributionValue {
  batchSize: number;
  batchIntervalSeconds: number;
  timeSlots: TimeSlot[];
  retryConfig: RetryConfig | null;
}

export function distributionSummary(v: DistributionValue): { line1: string; line2: string; retryOn: boolean } {
  return {
    line1: `Phân bổ ${v.batchSize} cuộc gọi mỗi ${v.batchIntervalSeconds}s`,
    line2: v.timeSlots.length
      ? v.timeSlots.map((s) => `${s.from} - ${s.to}`).join(', ')
      : 'Cả ngày',
    retryOn: !!v.retryConfig,
  };
}

export function DistributionModal({
  open, value, onClose, onSave,
}: { open: boolean; value: DistributionValue; onClose: () => void; onSave: (v: DistributionValue) => void }) {
  const [draft, setDraft] = useState<DistributionValue>(value);
  const [error, setError] = useState<string | null>(null);

  // đồng bộ lại khi mở
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) { setDraft(value); setError(null); setWasOpen(true); }
  if (!open && wasOpen) setWasOpen(false);

  function save() {
    if (draft.batchSize < 1 || draft.batchSize > 500) return setError('Số cuộc mỗi lần phân bổ phải trong [1, 500]');
    if (draft.batchIntervalSeconds < 10 || draft.batchIntervalSeconds > 3600) return setError('Chu kỳ phân bổ phải trong [10, 3600] giây');
    for (const slot of draft.timeSlots) {
      if (!/^\d{2}:\d{2}$/.test(slot.from) || !/^\d{2}:\d{2}$/.test(slot.to)) return setError('Khung giờ phải dạng HH:mm');
    }
    if (draft.retryConfig && (draft.retryConfig.maxRetry < 1 || draft.retryConfig.maxRetry > 10)) return setError('Số lần gọi lại tối đa trong [1, 10]');
    if (draft.retryConfig && draft.retryConfig.delaySeconds < 30) return setError('Thời gian chờ gọi lại tối thiểu 30 giây');
    onSave(draft);
    onClose();
  }

  return (
    <Modal open={open} title="Cấu hình phân bổ cuộc gọi" onClose={onClose}
      footer={<>
        <Button variant="primary" onClick={save}>Lưu cấu hình</Button>
        <Button onClick={onClose}>Đóng</Button>
        {error && <span className="self-center text-sm text-(--color-danger)">{error}</span>}
      </>}>
      <div className="space-y-5">
        <div>
          <h4 className="mb-2 text-sm font-bold">Phân bổ</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Số cuộc gọi mỗi lần (batch)">
              <input type="number" className={inputClass} value={draft.batchSize}
                onChange={(e) => setDraft({ ...draft, batchSize: Number(e.target.value) })} />
            </Field>
            <Field label="Chu kỳ phân bổ (giây)">
              <input type="number" className={inputClass} value={draft.batchIntervalSeconds}
                onChange={(e) => setDraft({ ...draft, batchIntervalSeconds: Number(e.target.value) })} />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-bold">Khung giờ cho phép gọi <span className="font-normal text-(--color-muted)">(trống = cả ngày)</span></h4>
            <Button onClick={() => setDraft({ ...draft, timeSlots: [...draft.timeSlots, { from: '08:00', to: '17:00' }] })}>
              + Thêm khung giờ
            </Button>
          </div>
          {draft.timeSlots.length === 0 && <p className="text-sm text-(--color-muted)">Cả ngày</p>}
          <div className="space-y-2">
            {draft.timeSlots.map((slot, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="time" className="rounded-lg border border-(--color-line) px-3 py-1.5 text-sm" value={slot.from}
                  onChange={(e) => updateSlot(i, { ...slot, from: e.target.value })} />
                <span className="text-(--color-muted)">→</span>
                <input type="time" className="rounded-lg border border-(--color-line) px-3 py-1.5 text-sm" value={slot.to}
                  onChange={(e) => updateSlot(i, { ...slot, to: e.target.value })} />
                <button className="text-(--color-danger)" onClick={() =>
                  setDraft({ ...draft, timeSlots: draft.timeSlots.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={!!draft.retryConfig}
              onChange={(e) => setDraft({
                ...draft,
                retryConfig: e.target.checked
                  ? { trigger: 'NO_ANSWER', maxRetry: 1, delaySeconds: 60 }
                  : null,
              })} />
            Gọi lại khi không nghe máy
          </label>
          {draft.retryConfig && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Số lần gọi lại tối đa">
                <input type="number" className={inputClass} value={draft.retryConfig.maxRetry}
                  onChange={(e) => setDraft({ ...draft, retryConfig: { ...draft.retryConfig!, maxRetry: Number(e.target.value) } })} />
              </Field>
              <Field label="Gọi lại sau (giây, từ lúc cuộc kết thúc)">
                <input type="number" className={inputClass} value={draft.retryConfig.delaySeconds}
                  onChange={(e) => setDraft({ ...draft, retryConfig: { ...draft.retryConfig!, delaySeconds: Number(e.target.value) } })} />
              </Field>
            </div>
          )}
          <p className="mt-2 text-xs text-(--color-muted)">
            Gọi lại theo hành vi bắt được từ callbot (BOT_ACTION) sẽ mở khi backend chốt danh mục action với team AI.
          </p>
        </div>
      </div>
    </Modal>
  );

  function updateSlot(index: number, slot: TimeSlot) {
    setDraft({ ...draft, timeSlots: draft.timeSlots.map((s, i) => (i === index ? slot : s)) });
  }
}
