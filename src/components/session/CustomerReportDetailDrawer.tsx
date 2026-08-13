'use client';
/**
 * Chi tiết một khách hàng trong báo cáo — bung `attempts[]` (từng lần quay số).
 *
 * Đây là chỗ DUY NHẤT xem được vì sao một khách bị gọi nhiều lần: API danh sách cố tình
 * KHÔNG trả attempts (phiên 200k KH mà mỗi dòng kèm mọi lần gọi thì response phình vô ích).
 *
 * Dữ liệu hiển thị là SNAPSHOT lúc gom, không tra danh bạ lúc mở — tên/giới tính có thể
 * cũ hơn CRM nếu khách được sửa sau khi phiên chạy xong. Đó là chủ đích của thiết kế BE.
 */
import { useEffect, useState } from 'react';
import type { CustomerReportDetail, CustomerReportRow } from '@/contracts/types';
import { ApiError } from '@/lib/apiClient';
import { sessionApi } from '@/lib/sessionApi';
import { Drawer } from '../ui';

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  ANSWERED: { label: 'Nghe máy', className: 'bg-(--color-primary-soft) text-(--color-primary-dark)' },
  NO_ANSWER: { label: 'Không nghe', className: 'bg-amber-50 text-amber-800' },
  FAILED: { label: 'Lỗi', className: 'bg-red-50 text-red-700' },
  PROCESSING: { label: 'Đang gọi', className: 'bg-sky-50 text-sky-700' },
  CANCELED: { label: 'Đã huỷ', className: 'bg-gray-100 text-gray-600' },
};

export function CustomerReportDetailDrawer({
  sessionId, sessionTimeMs, row, onClose,
}: {
  sessionId: string;
  sessionTimeMs: number;
  row: CustomerReportRow;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CustomerReportDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    sessionApi.customerReportDetail(sessionId, sessionTimeMs, row.phoneNumber)
      .then((d) => { if (alive) { setDetail(d); setError(null); } })
      .catch((e) => { if (alive) setError(e instanceof ApiError ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sessionId, sessionTimeMs, row.phoneNumber]);

  // Chưa tải xong thì dùng luôn dòng ở bảng — người dùng thấy nội dung ngay, không nhìn ô trống.
  const shown: CustomerReportDetail = detail ?? row;
  const attempts = detail?.attempts ?? [];

  return (
    <Drawer open onClose={onClose}>
      <div className="flex h-full flex-col">
        <div className="border-b border-(--color-line) px-6 py-4">
          <h3 className="text-lg font-bold">{shown.phoneNumber}</h3>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {shown.contactName || 'Số chưa có trong danh bạ'}
            {shown.gender ? ` · ${shown.gender}` : ''}
            {shown.birthdayString ? ` · ${shown.birthdayString}` : ''}
          </p>
          {(shown.customerStatus?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {shown.customerStatus!.map((s) => (
                <span key={s} className="rounded-full bg-(--color-field) px-2.5 py-0.5 text-xs">{s}</span>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <div className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</div>}

          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Số cuộc gọi" value={(shown.totalCall ?? 0).toLocaleString('vi-VN')}
              hint={(shown.retriedCalls ?? 0) > 0 ? `${shown.retriedCalls} lần gọi lại` : undefined} />
            <Stat label="Nghe máy" value={(shown.totalAnswered ?? 0).toLocaleString('vi-VN')} />
            {/* Hai mẫu số KHÁC NHAU — ghi rõ ở hint, đây là chỗ dễ đọc sai nhất của báo cáo. */}
            <Stat label="TB mỗi cuộc" value={avg(shown.totalBillSec, shown.totalCall)}
              hint="tổng thời lượng ÷ số cuộc" />
            <Stat label="TB mỗi lần kết nối" value={avg(shown.totalAnswerSec, shown.totalAnswered)}
              hint="chỉ chia cuộc nghe máy" />
            {/* BE đã chia sẵn theo số cuộc ĐO ĐƯỢC — không tự chia lại ở FE. */}
            <Stat label="TB đổ chuông" value={formatMs(shown.avgRingingTimeMs)}
              hint="chỉ cuộc đo được mốc" />
            <Stat label="TB đàm thoại" value={formatMs(shown.avgTalkTimeMs)}
              hint="luôn nhỏ hơn thời lượng gọi" />
          </div>

          <h4 className="mb-2 text-sm font-bold">
            Từng lần gọi
            {loading && <span className="ml-2 font-normal text-(--color-muted)">đang tải…</span>}
          </h4>

          {!loading && attempts.length === 0 ? (
            <p className="py-4 text-sm text-(--color-muted)">
              {detail
                ? 'Dòng gom không có chi tiết lần gọi.'
                : 'Không lấy được chi tiết lần gọi.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-(--color-field) text-left text-xs text-(--color-muted)">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Lần</th>
                    <th className="px-3 py-2 font-semibold">Trạng thái</th>
                    <th className="px-3 py-2 font-semibold">Thời điểm</th>
                    <th className="px-3 py-2 text-right font-semibold">Thời lượng</th>
                    <th className="px-3 py-2 text-right font-semibold">Kết nối</th>
                    <th className="px-3 py-2 text-right font-semibold">Đổ chuông</th>
                    <th className="px-3 py-2 text-right font-semibold">Đàm thoại</th>
                    <th className="px-3 py-2 font-semibold">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a, i) => {
                    const style = STATUS_STYLE[a.status ?? ''] ?? {
                      label: a.status || '—', className: 'bg-gray-100 text-gray-600',
                    };
                    return (
                      <tr key={`${a.recordId ?? i}`} className="border-t border-(--color-line)">
                        <td className="px-3 py-2">
                          {!a.retryCount
                            ? <span className="text-(--color-muted)">gọi đầu</span>
                            : <span className="font-semibold text-amber-700">gọi lại {a.retryCount}</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.className}`}>
                            {style.label}
                          </span>
                          {a.isFailedPreDial && (
                            // Phân biệt "gọi mà không ai nghe" với "chưa từng quay số" — cùng
                            // hiện FAILED nhưng ý nghĩa vận hành khác hẳn.
                            <span className="ml-2 text-xs text-(--color-muted)">chưa quay số</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-(--color-muted)">{formatTime(a.callTimeMs)}</td>
                        <td className="px-3 py-2 text-right">{formatDuration(a.billSec)}</td>
                        <td className="px-3 py-2 text-right">{formatDuration(a.answerSec)}</td>
                        <td className="px-3 py-2 text-right">{formatMs(a.ringingTimeMs)}</td>
                        {/* Đàm thoại LUÔN nhỏ hơn "Thời lượng" — đúng theo định nghĩa, không phải lỗi. */}
                        <td className="px-3 py-2 text-right">{formatMs(a.talkTimeMs)}</td>
                        <td className="px-3 py-2 text-xs text-(--color-muted)">{a.cause || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-(--color-line) p-3">
      <div className="text-xs text-(--color-muted)">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-(--color-muted)">{hint}</div>}
    </div>
  );
}

/** Mẫu số 0 → "—", KHÔNG phải 0s: chia cho 0 là "không có dữ liệu", không phải "bằng không". */
function avg(totalSec?: number | null, count?: number | null): string {
  if (totalSec == null || !count) return '—';
  return formatDuration(Math.round(totalSec / count));
}

/**
 * Thời lượng MILI GIÂY (đổ chuông / đàm thoại) — khác `formatDuration` vốn nhận GIÂY.
 * Dưới 10s hiện 1 chữ số thập phân: đổ chuông thường vài giây, làm tròn mất hết chi tiết.
 */
function formatMs(ms?: number | null): string {
  if (ms == null) return '—';
  if (ms <= 0) return '0s';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatDuration(Math.round(ms / 1000));
}

/** null = chưa tra được CDR, khác hẳn 0 giây. */
function formatDuration(seconds?: number | null): string {
  if (seconds == null) return '—';
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}p ${String(seconds % 60).padStart(2, '0')}s`;
}

function formatTime(ms?: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
