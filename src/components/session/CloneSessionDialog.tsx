'use client';
/**
 * "Gọi lại phiên" — nhân bản phiên, bám 4 cloneTypes của AutoCall
 * (web-v2 MarketingData.cloneTypes: justConfig / allCustomer / allCustomerCallFail / filterOption).
 *
 * Ánh xạ sang CallBot: BE nhận {copyConfig, dataFilter.callStatuses} nên 4 kiểu của AutoCall
 * diễn đạt được trọn vẹn — chỉ đổi "filterOption" (AutoCall lọc theo filter đang cache trên màn
 * danh sách) thành chọn thẳng trạng thái cuộc gọi, rõ ràng hơn cho người dùng.
 */
import { useState } from 'react';
import type { ClientSession, CloneMode } from '@/contracts/types';
import { Button, Modal } from '../ui';

interface ModeOption {
  key: CloneMode;
  label: string;
  description: string;
  callStatuses: string[] | null;
}

const MODES: ModeOption[] = [
  {
    key: 'CONFIG_ONLY',
    label: 'Chỉ sao chép cấu hình',
    description: 'Phiên mới giữ kịch bản, đầu số, phân bổ — bạn tự nạp danh sách khách hàng mới.',
    callStatuses: null,
  },
  {
    key: 'ALL_CUSTOMERS',
    label: 'Toàn bộ khách hàng',
    description: 'Gọi lại tất cả khách hàng của phiên cũ, bất kể kết quả lần trước.',
    callStatuses: ['ANSWERED', 'NO_ANSWER', 'FAILED', 'CANCELED', 'PROCESSING'],
  },
  {
    key: 'FAILED_ONLY',
    label: 'Khách hàng chưa tiếp cận được',
    description: 'Chỉ lấy khách không nghe máy, gọi lỗi hoặc bị huỷ — thường dùng nhất.',
    callStatuses: ['NO_ANSWER', 'FAILED', 'CANCELED'],
  },
  {
    key: 'BY_CALL_STATUS',
    label: 'Chọn theo kết quả cuộc gọi',
    description: 'Tự chọn những kết quả muốn gọi lại.',
    callStatuses: [],
  },
];

const STATUS_LABELS: Record<string, string> = {
  ANSWERED: 'Nghe máy',
  NO_ANSWER: 'Không nghe',
  FAILED: 'Lỗi',
  CANCELED: 'Đã huỷ',
  PROCESSING: 'Chưa có kết quả',
};

export function CloneSessionDialog({
  open, session, busy, onClose, onConfirm,
}: {
  open: boolean;
  session: ClientSession;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (params: { copyConfig: boolean; callStatuses: string[] | null; name: string }) => void;
}) {
  const [mode, setMode] = useState<CloneMode>('FAILED_ONLY');
  const [picked, setPicked] = useState<string[]>(['NO_ANSWER']);
  const [name, setName] = useState('');
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) {
    setMode('FAILED_ONLY');
    setPicked(['NO_ANSWER']);
    setName(`${session.name} (gọi lại)`);
    setWasOpen(true);
  }
  if (!open && wasOpen) setWasOpen(false);

  const selectedMode = MODES.find((m) => m.key === mode)!;
  const callStatuses = mode === 'BY_CALL_STATUS' ? picked : selectedMode.callStatuses;
  const invalid = mode === 'BY_CALL_STATUS' && picked.length === 0;

  return (
    <Modal open={open} title="Gọi lại phiên (nhân bản)" onClose={onClose}
      footer={<>
        <Button variant="primary" disabled={busy || invalid}
          onClick={() => onConfirm({ copyConfig: true, callStatuses, name: name.trim() })}>
          {busy ? 'Đang tạo…' : 'Tạo phiên nháp'}
        </Button>
        <Button disabled={busy} onClick={onClose}>Đóng</Button>
        {invalid && <span className="self-center text-sm text-(--color-danger)">Chọn ít nhất 1 kết quả</span>}
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-(--color-muted)">
          Phiên mới được tạo ở trạng thái <b>nháp</b> — bạn xem lại rồi tự bấm tạo, không tự động gọi.
        </p>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Tên phiên mới</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-(--radius-field) border border-(--color-line) px-3 py-2 text-sm outline-none focus:border-(--color-primary)" />
        </label>

        <div className="space-y-2">
          <span className="block text-sm font-semibold">Mang gì sang phiên mới?</span>
          {MODES.map((option) => (
            <label key={option.key}
              className={`flex cursor-pointer gap-3 rounded-(--radius-field) border px-4 py-3 transition ${
                mode === option.key
                  ? 'border-(--color-primary) bg-(--color-primary-soft)'
                  : 'border-(--color-line) hover:bg-(--color-field)'}`}>
              <input type="radio" name="clone-mode" className="mt-0.5" checked={mode === option.key}
                onChange={() => setMode(option.key)} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="block text-xs text-(--color-muted)">{option.description}</span>
              </span>
            </label>
          ))}
        </div>

        {mode === 'BY_CALL_STATUS' && (
          <div className="rounded-(--radius-field) bg-(--color-field) px-4 py-3">
            <span className="mb-2 block text-sm font-semibold">Kết quả cuộc gọi muốn gọi lại</span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(STATUS_LABELS).map(([value, label]) => {
                const active = picked.includes(value);
                return (
                  <button key={value} type="button"
                    onClick={() => setPicked((prev) =>
                      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value])}
                    className={`rounded-full px-3 py-1 text-[13px] font-medium transition ${
                      active ? 'bg-(--color-navy) text-white' : 'bg-white text-(--color-ink) ring-1 ring-(--color-line)'}`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
