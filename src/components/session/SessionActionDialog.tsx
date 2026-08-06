'use client';
/**
 * Xác nhận tạm dừng / huỷ phiên — chỗ AutoCall có MAPauseButton + DialogConfirm.
 *
 * KHÁC AutoCall (giới hạn backend, không phải lựa chọn thiết kế): AutoCall cho chọn THỜI LƯỢNG
 * tạm dừng (3 phút … 24 giờ) rồi phiên tự chạy lại; endpoint pause của callbot-service hiện chỉ
 * nhận {id, cause}, không có pauseUntilTime. Nên ở đây cho chọn LÝ DO tạm dừng và nói rõ là
 * phải bấm "Tiếp tục" bằng tay — hứa hẹn tự chạy lại mà backend không làm được thì tệ hơn.
 * (Đã ghi vào danh sách nợ BE.)
 */
import { useState } from 'react';
import { Button, Modal } from '../ui';

const PAUSE_REASONS = [
  'Tạm dừng để kiểm tra kịch bản',
  'Sai danh sách khách hàng',
  'Ngoài giờ làm việc',
  'Theo yêu cầu khách hàng',
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
  onConfirm: (cause: string) => void;
}) {
  const [cause, setCause] = useState('');
  const [wasOpen, setWasOpen] = useState(false);

  // reset mỗi lần mở lại
  if (open && !wasOpen) { setCause(''); setWasOpen(true); }
  if (!open && wasOpen) setWasOpen(false);

  if (!action) return null;
  const isCancel = action === 'cancel';
  const reasons = isCancel ? CANCEL_REASONS : PAUSE_REASONS;

  return (
    <Modal open={open} title={isCancel ? 'Huỷ phiên gọi' : 'Tạm dừng phiên gọi'} onClose={onClose}
      footer={<>
        <Button variant={isCancel ? 'danger' : 'primary'} disabled={busy}
          onClick={() => onConfirm(cause.trim())}>
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
            Phiên sẽ ngừng phân bổ cuộc gọi mới và <b>đứng yên cho tới khi bạn bấm “Tiếp tục”</b>
            {' '}— hệ thống không tự chạy lại. Các cuộc đang gọi vẫn chạy tới khi kết thúc.
          </div>
        )}

        <p className="text-sm text-(--color-muted)">
          Phiên: <b className="text-(--color-ink)">{sessionName}</b>
        </p>

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
