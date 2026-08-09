'use client';
/**
 * Khối "Cấu hình phiên" ở màn chi tiết — tương đương MACDetailInfoV2 của AutoCall
 * (web-v2 hiện đầu số, nội dung cuộc gọi, phân bổ, khung giờ, người tạo ngay cạnh KPI).
 *
 * Vì sao cần: khi phiên đang chạy, người vận hành phải trả lời được "phiên này đang gọi bằng
 * đầu số nào, kịch bản nào, mỗi lần bao nhiêu cuộc" mà KHÔNG phải mở lại màn cấu hình.
 */
import type { ClientSession } from '@/contracts/types';
import { daysLabel } from './DistributionModal';

export function SessionConfigPanel({
  session, scriptName, voiceLabel,
}: { session: ClientSession; scriptName?: string; voiceLabel?: string }) {
  const retry = session.retryConfig;
  const slots = session.timeSlots ?? [];

  return (
    <div>
      <h3 className="mb-3 text-[15px] font-bold">Cấu hình phiên</h3>
      <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
        <div>
          <Row label="Kịch bản" value={scriptName || session.scriptUuid || '—'} />
          <Row label="Giọng đọc" value={voiceLabel || 'Theo kịch bản'} />
          <Row label="Đầu số"
            value={session.sipNumbers?.length
              ? session.sipNumbers.map((sip) => sip.number).join(', ')
              : '—'} />
          <Row label="Mục đích" value={session.purpose || '—'} />
        </div>
        <div>
          <Row label="Phân bổ"
            value={`${session.batchSize} cuộc mỗi ${session.batchIntervalSeconds}s`} />
          <Row label="Khung giờ cho phép"
            value={slots.length > 0
              ? slots.map((slot) => {
                  const days = daysLabel(slot.daysOfWeek);
                  return `${slot.from}–${slot.to}${days ? ` (${days})` : ''}`;
                }).join(' · ')
              : 'Cả ngày'} />
          <Row label="Gọi lại khi không nghe máy"
            value={retry
              ? `Tối đa ${retry.maxRetry} lần, cách ${retry.delaySeconds}s`
              : 'Không'} />
          <Row label="Chờ kết nối"
            value={session.ringTimeoutSeconds ? `${session.ringTimeoutSeconds}s` : 'Mặc định tổng đài'} />
          <Row label="Thời lượng cuộc tối đa"
            value={session.maxCallTimeSeconds ? `${session.maxCallTimeSeconds}s` : 'Không giới hạn'} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-(--color-line) pt-3 text-xs text-(--color-muted)">
        <span>Tạo lúc {formatTime(session.createdTimeMs)}</span>
        {session.submittedTimeMs && <span>Submit lúc {formatTime(session.submittedTimeMs)}</span>}
        {session.startTimeMs && <span>Hẹn chạy {formatTime(session.startTimeMs)}</span>}
        {session.completedTimeMs && <span>Kết thúc {formatTime(session.completedTimeMs)}</span>}
        {session.timezoneId && <span>Múi giờ {session.timezoneId}</span>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 border-b border-(--color-line) py-1.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-(--color-muted)">{label}</span>
      <span className="min-w-0 flex-1 break-words text-sm">{value}</span>
    </div>
  );
}

function formatTime(ms?: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('vi-VN');
}
