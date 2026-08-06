'use client';
/**
 * Drawer "Xem chi tiết kịch bản" — tương đương MktDrawerCallBotScript của AutoCall
 * (web-v2 mở CDrawer rộng 1214px hiện sơ đồ kịch bản + hội thoại mẫu).
 *
 * Ở đây thu hẹp lại đúng phần dữ liệu mà API hiện có trả về được: định danh, phiên bản và
 * danh sách biến. Sơ đồ luồng hội thoại nằm ở service chatbot, chưa có endpoint cho client này
 * — ghi nhận là nợ BE, không dựng UI giả.
 */
import { useEffect, useState } from 'react';
import type { CallbotScript } from '@/contracts/types';
import { sessionApi } from '@/lib/sessionApi';
import { ApiError } from '@/lib/apiClient';
import { Button, Drawer } from '../ui';

export function ScriptDetailDrawer({
  open, scriptUuid, fallbackName, onClose,
}: {
  open: boolean;
  scriptUuid: string;
  /** Tên đã biết từ danh mục — hiện ngay để drawer không trống trong lúc chờ API. */
  fallbackName?: string;
  onClose: () => void;
}) {
  const [script, setScript] = useState<CallbotScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !scriptUuid) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sessionApi.scriptsByUuids([scriptUuid])
      .then((list) => { if (!cancelled) setScript(list[0] ?? null); })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, scriptUuid]);

  const variables = script?.variables ?? [];

  return (
    <Drawer open={open} onClose={onClose} width="w-[720px]">
      <div className="flex h-full flex-col">
        <div className="border-b border-(--color-line) bg-(--color-navy) px-6 py-4 text-white">
          <h3 className="text-base font-bold">Chi tiết kịch bản</h3>
          <p className="mt-0.5 text-sm opacity-80">{script?.name ?? fallbackName ?? scriptUuid}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && <p className="text-sm text-(--color-muted)">Đang tải chi tiết kịch bản…</p>}

          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              Không lấy được chi tiết kịch bản — {error}
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-5">
              <div className="rounded-(--radius-field) bg-(--color-field) px-4 py-3">
                <Row label="Tên kịch bản" value={script?.name ?? fallbackName ?? '—'} />
                <Row label="UUID" value={scriptUuid} mono />
                {script?.version != null && <Row label="Phiên bản" value={`v${script.version}`} />}
                {script?.isNewestVersion != null && (
                  <Row label="Trạng thái phiên bản"
                    value={script.isNewestVersion ? 'Đang dùng bản mới nhất' : 'Không phải bản mới nhất'} />
                )}
              </div>

              <div>
                <h4 className="mb-2 text-sm font-bold">
                  Biến kịch bản {variables.length > 0 && <span className="font-normal text-(--color-muted)">({variables.length})</span>}
                </h4>
                {variables.length === 0 ? (
                  <p className="text-sm text-(--color-muted)">
                    Kịch bản này không khai báo biến — chỉ cần số điện thoại là gọi được.
                  </p>
                ) : (
                  <>
                    <p className="mb-2 text-sm text-(--color-muted)">
                      File Excel nạp khách hàng cần có đủ các cột dưới đây, nếu không dòng đó sẽ bị đánh
                      không hợp lệ.
                    </p>
                    <div className="overflow-hidden rounded-lg border border-(--color-line)">
                      <table className="w-full text-sm">
                        <thead className="bg-(--color-field) text-left text-xs text-(--color-muted)">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Mã biến</th>
                            <th className="px-3 py-2 font-semibold">Tên hiển thị</th>
                            <th className="px-3 py-2 font-semibold">Kiểu</th>
                          </tr>
                        </thead>
                        <tbody>
                          {variables.map((variable) => (
                            <tr key={variable.fieldCode} className="border-t border-(--color-line)">
                              <td className="px-3 py-2 font-mono text-[13px]">{variable.fieldCode}</td>
                              <td className="px-3 py-2">{variable.fieldName || '—'}</td>
                              <td className="px-3 py-2 text-(--color-muted)">{variable.type || 'text'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
                Sơ đồ luồng hội thoại và bản ghi mẫu hiện chỉ xem được ở màn AI Callbot của OmiCRM —
                service callbot chưa mở endpoint chi tiết kịch bản cho app này.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-(--color-line) px-6 py-4">
          <Button onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </Drawer>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 border-b border-(--color-line) py-1.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-(--color-muted)">{label}</span>
      <span className={`min-w-0 flex-1 break-all text-sm ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</span>
    </div>
  );
}
