'use client';
/**
 * Dialog xác nhận trước khi publish phiên — tương đương MarketingDialogConfirmCreate của AutoCall.
 *
 * Vì sao cần: submit là hành động BẤT KHẢ HỒI ở mức nghiệp vụ — phiên chuyển SCHEDULED,
 * bắt đầu nổ cuộc gọi thật và tốn tiền; muốn dừng chỉ còn cách cancel (không có "un-submit").
 * Nên bắt buộc người dùng đọc lại tóm tắt: gọi cho bao nhiêu người, bằng đầu số nào, kịch bản nào.
 */
import type { RetryConfig, SipNumber, TimeSlot } from '@/contracts/types';
import { Button, Modal } from '../ui';
import { daysLabel } from './DistributionModal';

export interface ConfirmCreateSummary {
  name: string;
  purpose?: string;
  scriptName?: string;
  voiceLabel?: string;
  sipNumbers: SipNumber[];
  startTimeMs: number | null;
  batchSize: number;
  batchIntervalSeconds: number;
  timeSlots: TimeSlot[];
  retryConfig: RetryConfig | null;
  ringTimeoutSeconds: number | null;
  totalRows: number;
}

export function ConfirmCreateDialog({
  open, summary, busy, onClose, onConfirm,
}: {
  open: boolean;
  summary: ConfirmCreateSummary;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const estimate = estimateDuration(summary);

  return (
    <Modal open={open} title="Xác nhận tạo phiên" onClose={onClose}
      footer={<>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {busy ? 'Đang tạo…' : 'Tạo phiên và bắt đầu'}
        </Button>
        <Button disabled={busy} onClick={onClose}>Xem lại cấu hình</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-(--color-muted)">
          Phiên sẽ bắt đầu gọi tự động theo cấu hình dưới đây. Sau khi tạo, chỉ có thể tạm dừng
          hoặc huỷ — không quay lại trạng thái nháp được.
        </p>

        <div className="rounded-(--radius-field) bg-(--color-field) px-4 py-3">
          <Row label="Tên phiên" value={summary.name} strong />
          {summary.purpose && <Row label="Mục đích" value={summary.purpose} />}
          <Row label="Kịch bản" value={summary.scriptName ?? '—'} />
          {summary.voiceLabel && <Row label="Giọng đọc" value={summary.voiceLabel} />}
          <Row label="Đầu số"
            value={summary.sipNumbers.length > 0
              ? summary.sipNumbers.map((sip) => sip.number).join(', ')
              : '—'} />
          <Row label="Thời gian bắt đầu"
            value={summary.startTimeMs ? new Date(summary.startTimeMs).toLocaleString('vi-VN') : 'Ngay khi tạo'} />
          <Row label="Khung giờ cho phép"
            value={summary.timeSlots.length > 0
              ? summary.timeSlots.map((slot) => {
                  const days = daysLabel(slot.daysOfWeek);
                  return `${slot.from}–${slot.to}${days ? ` (${days})` : ''}`;
                }).join(' · ')
              : 'Cả ngày'} />
          <Row label="Phân bổ"
            value={`${summary.batchSize} cuộc mỗi ${summary.batchIntervalSeconds}s`} />
          {summary.ringTimeoutSeconds != null && (
            <Row label="Chờ kết nối" value={`${summary.ringTimeoutSeconds}s`} />
          )}
          <Row label="Gọi lại khi không nghe máy"
            value={summary.retryConfig
              ? `Có — tối đa ${summary.retryConfig.maxRetry} lần, cách ${summary.retryConfig.delaySeconds}s`
              : 'Không'} />
        </div>

        <div className="flex items-center justify-between rounded-(--radius-field) bg-(--color-primary-soft) px-4 py-3">
          <div>
            <div className="text-xs text-(--color-primary-dark)">Số khách hàng sẽ được gọi</div>
            <div className="text-2xl font-bold text-(--color-primary-dark)">
              {summary.totalRows.toLocaleString('vi-VN')}
            </div>
          </div>
          {estimate && (
            <div className="text-right">
              <div className="text-xs text-(--color-primary-dark)">Thời gian phân bổ dự kiến</div>
              <div className="text-[15px] font-semibold text-(--color-primary-dark)">{estimate}</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex gap-3 border-b border-(--color-line) py-1.5 last:border-0">
      <span className="w-44 shrink-0 text-sm text-(--color-muted)">{label}</span>
      <span className={`min-w-0 flex-1 break-words text-sm ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

/**
 * Thời gian để phân bổ HẾT data (không phải thời gian kết thúc cuộc gọi cuối) — AutoCall cũng
 * hiện một con số dự kiến ở dialog này. Chỉ tính phần phân bổ vì đó là thứ duy nhất suy ra được
 * từ config; thời lượng đàm thoại thực tế phụ thuộc khách hàng nên không đoán.
 */
function estimateDuration(summary: ConfirmCreateSummary): string | null {
  const { totalRows, batchSize, batchIntervalSeconds } = summary;
  if (totalRows <= 0 || batchSize <= 0 || batchIntervalSeconds <= 0) return null;

  const batches = Math.ceil(totalRows / batchSize);
  const seconds = Math.max(0, batches - 1) * batchIntervalSeconds;
  if (seconds < 60) return 'dưới 1 phút';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `~${hours} giờ` : `~${hours} giờ ${remainder} phút`;
}
