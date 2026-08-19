'use client';
/**
 * Xác nhận tạm dừng / huỷ phiên — chỗ AutoCall có MAPauseButton + DialogConfirm.
 *
 * KHÁC AutoCall CÓ CHỦ Ý (quyết định owner, không phải giới hạn kỹ thuật): AutoCall BẮT BUỘC chọn
 * thời lượng (3 phút … 24 giờ) rồi tự chạy lại. Ở đây "dừng chủ động thì cũng chủ động chạy lại"
 * là MẶC ĐỊNH — hẹn giờ chỉ là tuỳ chọn thêm cho ai cần. Vì vậy mặc định luôn là "Tới khi tôi bấm
 * Tiếp tục"; đừng đổi thứ tự để giống AutoCall.
 */
import { useState } from 'react';
import { Button, Modal } from '../ui';

const PAUSE_REASONS = [
  'Tạm dừng để kiểm tra kịch bản',
  'Sai danh sách khách hàng',
  'Ngoài giờ làm việc',
  'Theo yêu cầu khách hàng',
];

/** Tuỳ chọn hẹn giờ. null = dừng vô thời hạn (mặc định, phải là lựa chọn ĐẦU TIÊN). */
const PAUSE_DURATIONS: Array<{ label: string; minutes: number | null }> = [
  { label: 'Tới khi tôi bấm Tiếp tục', minutes: null },
  { label: '30 phút', minutes: 30 },
  { label: '1 giờ', minutes: 60 },
  { label: '3 giờ', minutes: 180 },
  { label: 'Hết ngày hôm nay (8 giờ)', minutes: 480 },
];

const CANCEL_REASONS = [
  'Sai danh sách khách hàng',
  'Sai kịch bản / nội dung',
  'Huỷ theo yêu cầu khách hàng',
  'Tạo lại phiên khác',
];

export function SessionActionDialog({
  open, action, sessionName, remaining, busy, onClose, onConfirm,
}: {
  open: boolean;
  action: 'pause' | 'cancel' | null;
  sessionName: string;
  /** Số khách hàng chưa gọi — con số quyết định khi huỷ. */
  remaining: number;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (cause: string, pauseMinutes: number | null) => void;
}) {
  const [cause, setCause] = useState('');
  const [pauseMinutes, setPauseMinutes] = useState<number | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  // reset mỗi lần mở lại — kể cả thời lượng, để lần pause sau không thừa hưởng lựa chọn lần trước
  if (open && !wasOpen) { setCause(''); setPauseMinutes(null); setWasOpen(true); }
  if (!open && wasOpen) setWasOpen(false);

  if (!action) return null;
  const isCancel = action === 'cancel';
  const reasons = isCancel ? CANCEL_REASONS : PAUSE_REASONS;

  return (
    <Modal open={open} title={isCancel ? 'Huỷ phiên gọi' : 'Tạm dừng phiên gọi'} onClose={onClose}
      footer={<>
        <Button variant={isCancel ? 'danger' : 'primary'} disabled={busy}
          onClick={() => onConfirm(cause.trim(), isCancel ? null : pauseMinutes)}>
          {busy ? 'Đang xử lý…' : isCancel ? 'Huỷ phiên' : 'Tạm dừng'}
        </Button>
        <Button disabled={busy} onClick={onClose}>Không, giữ nguyên</Button>
      </>}>
      <div className="space-y-4">
        {isCancel ? (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            <b>Huỷ phiên không thể hoàn tác.</b> {remaining.toLocaleString('vi-VN')} khách hàng chưa
            gọi sẽ bị loại khỏi phiên; các cuộc đang gọi vẫn chạy tới khi kết thúc. Muốn gọi lại
            số này, bạn phải nhân bản phiên.
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Phiên sẽ ngừng phân bổ cuộc gọi mới.{' '}
            {pauseMinutes === null
              ? <>Phiên <b>đứng yên cho tới khi bạn bấm “Tiếp tục”</b> — hệ thống không tự chạy lại.</>
              : <>Phiên sẽ <b>tự chạy lại sau {PAUSE_DURATIONS.find((d) => d.minutes === pauseMinutes)?.label.toLowerCase()}</b>,
                  hoặc sớm hơn nếu bạn bấm “Tiếp tục”.</>}
            {' '}Các cuộc đang gọi vẫn chạy tới khi kết thúc.
          </div>
        )}

        <p className="text-sm text-(--color-muted)">
          Phiên: <b className="text-(--color-ink)">{sessionName}</b>
        </p>

        {!isCancel && (
          <div>
            <span className="mb-2 block text-sm font-semibold">Tạm dừng trong bao lâu</span>
            <div className="flex flex-wrap gap-2">
              {PAUSE_DURATIONS.map((d) => (
                <button key={d.label} type="button" onClick={() => setPauseMinutes(d.minutes)}
                  className={`rounded-full px-3 py-1 text-[13px] transition ${
                    pauseMinutes === d.minutes
                      ? 'bg-(--color-navy) text-white'
                      : 'bg-(--color-field) text-(--color-ink) hover:bg-gray-200'}`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className="mb-2 block text-sm font-semibold">
            Lý do {isCancel ? 'huỷ' : 'tạm dừng'} <span className="font-normal text-(--color-muted)">(không bắt buộc)</span>
          </span>
          <div className="mb-2 flex flex-wrap gap-2">
            {reasons.map((reason) => (
              <button key={reason} type="button" onClick={() => setCause(reason)}
                className={`rounded-full px-3 py-1 text-[13px] transition ${
                  cause === reason
                    ? 'bg-(--color-navy) text-white'
                    : 'bg-(--color-field) text-(--color-ink) hover:bg-gray-200'}`}>
                {reason}
              </button>
            ))}
          </div>
          <input value={cause} onChange={(e) => setCause(e.target.value)}
            placeholder="Hoặc nhập lý do khác…"
            className="w-full rounded-(--radius-field) border border-(--color-line) px-3 py-2 text-sm outline-none focus:border-(--color-primary)" />
          <p className="mt-1.5 text-xs text-(--color-muted)">
            Lý do được lưu cùng phiên để người khác biết vì sao phiên dừng.
          </p>
        </div>
      </div>
    </Modal>
  );
}
