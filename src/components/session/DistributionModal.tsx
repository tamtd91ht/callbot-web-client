'use client';
/**
 * Modal "Thay đổi" của card phân bổ (template img.png):
 * batchSize + batchIntervalSeconds (phân bổ), timeSlots (khung giờ), retryConfig (gọi lại).
 */
import { useState } from 'react';
import type { RetryConfig, RetryTrigger, TimeSlot } from '@/contracts/types';
import type { ContactStatusOption } from '@/lib/catalogApi';
import { LIMITS, validateDistribution } from '@/lib/validation';
import { Button, Field, Modal, inputClass } from '../ui';

export interface DistributionValue {
  batchSize: number;
  batchIntervalSeconds: number;
  timeSlots: TimeSlot[];
  retryConfig: RetryConfig | null;
}

/** [FR-004] Nhãn ngày ISO 1..7. */
const DAY_LABELS: Record<number, string> = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** "T2–T6" cho dải liền, "T2, T4, CN" cho rời; rỗng khi mọi ngày (không cần nói). */
export function daysLabel(daysOfWeek?: number[]): string {
  if (!daysOfWeek || daysOfWeek.length === 0 || daysOfWeek.length === 7) return '';
  const days = [...daysOfWeek].sort((a, b) => a - b);
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (contiguous && days.length > 2) return `${DAY_LABELS[days[0]]}–${DAY_LABELS[days[days.length - 1]]}`;
  return days.map((d) => DAY_LABELS[d]).join(', ');
}

export function distributionSummary(v: DistributionValue): { line1: string; line2: string; retryOn: boolean } {
  return {
    line1: `Phân bổ ${v.batchSize} cuộc gọi mỗi ${v.batchIntervalSeconds}s`,
    line2: v.timeSlots.length
      ? v.timeSlots.map((s) => {
          const days = daysLabel(s.daysOfWeek);
          return `${s.from} - ${s.to}${days ? ` · ${days}` : ''}`;
        }).join(', ')
      : 'Cả ngày',
    retryOn: !!v.retryConfig,
  };
}

export function DistributionModal({
  open, value, onClose, onSave, contactStatuses = [],
}: {
  open: boolean;
  value: DistributionValue;
  onClose: () => void;
  onSave: (v: DistributionValue) => void;
  /** Danh mục trạng thái khách (tenant-config /filter-contact/list) — chỉ dùng cho CONTACT_STATUS. */
  contactStatuses?: ContactStatusOption[];
}) {
  const [draft, setDraft] = useState<DistributionValue>(value);
  const [error, setError] = useState<string | null>(null);

  // đồng bộ lại khi mở
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) { setDraft(value); setError(null); setWasOpen(true); }
  if (!open && wasOpen) setWasOpen(false);

  function save() {
    // validate dùng chung với màn Tạo phiên (lib/validation) — một nguồn ràng buộc duy nhất,
    // khỏi lệch bound giữa modal và lúc submit
    const message = validateDistribution(draft);
    if (message) return setError(message);
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
            <Field label={`Số cuộc gọi mỗi lần (${LIMITS.batchSize.min}–${LIMITS.batchSize.max})`}>
              <input type="number" min={LIMITS.batchSize.min} max={LIMITS.batchSize.max}
                className={inputClass} value={draft.batchSize}
                onChange={(e) => setDraft({ ...draft, batchSize: Number(e.target.value) })} />
            </Field>
            <Field label={`Chu kỳ phân bổ (${LIMITS.batchIntervalSeconds.min}–${LIMITS.batchIntervalSeconds.max} giây)`}>
              <input type="number" min={LIMITS.batchIntervalSeconds.min} max={LIMITS.batchIntervalSeconds.max}
                className={inputClass} value={draft.batchIntervalSeconds}
                onChange={(e) => setDraft({ ...draft, batchIntervalSeconds: Number(e.target.value) })} />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-bold">Khung giờ cho phép gọi <span className="font-normal text-(--color-muted)">(trống = cả ngày)</span></h4>
            <Button onClick={() => setDraft({
              ...draft,
              timeSlots: [...draft.timeSlots, { from: '08:00', to: '17:00', daysOfWeek: [...ALL_DAYS] }],
            })}>
              + Thêm khung giờ
            </Button>
          </div>
          {draft.timeSlots.length === 0 && <p className="text-sm text-(--color-muted)">Cả ngày</p>}
          <div className="space-y-3">
            {draft.timeSlots.map((slot, i) => (
              <div key={i} className="rounded-lg border border-(--color-line) p-2.5">
                <div className="flex items-center gap-2">
                  <input type="time" className="rounded-lg border border-(--color-line) px-3 py-1.5 text-sm" value={slot.from}
                    onChange={(e) => updateSlot(i, { ...slot, from: e.target.value })} />
                  <span className="text-(--color-muted)">→</span>
                  <input type="time" className="rounded-lg border border-(--color-line) px-3 py-1.5 text-sm" value={slot.to}
                    onChange={(e) => updateSlot(i, { ...slot, to: e.target.value })} />
                  <button className="ml-auto text-(--color-danger)" title="Xoá khung giờ" onClick={() =>
                    setDraft({ ...draft, timeSlots: draft.timeSlots.filter((_, j) => j !== i) })}>✕</button>
                </div>
                {/* [FR-004] ngày áp RIÊNG cho từng khung giờ — không chọn gì hiển thị = mọi ngày */}
                <div className="mt-2 flex items-center gap-1.5">
                  {ALL_DAYS.map((day) => {
                    const selected = !slot.daysOfWeek || slot.daysOfWeek.includes(day);
                    return (
                      <button key={day} type="button"
                        onClick={() => updateSlot(i, { ...slot, daysOfWeek: toggleDay(slot.daysOfWeek, day) })}
                        className={`h-8 w-9 rounded-lg border text-xs font-semibold ${
                          selected
                            ? 'border-(--color-primary) bg-(--color-primary) text-white'
                            : 'border-(--color-line) bg-white text-(--color-muted)'}`}>
                        {DAY_LABELS[day]}
                      </button>
                    );
                  })}
                </div>
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
                  // Mặc định đúng cái BE chạy được: kết quả cuộc gọi + không nghe máy.
                  ? { trigger: 'CALL_STATUS', actionCodes: ['NO_ANSWER'], maxRetry: 1, delaySeconds: 60 }
                  : null,
              })} />
            Gọi lại tự động
          </label>
          {draft.retryConfig && (
            <div className="mt-3">
              <Field label="Điều kiện gọi lại — chỉ chọn 1 nhóm">
                <div className="flex flex-col gap-2">
                  {RETRY_TRIGGERS.map(({ trigger, label, hint }) => (
                    <label key={trigger} className="flex items-start gap-2 text-sm">
                      <input type="radio" name="retryTrigger" className="mt-0.5"
                        checked={draft.retryConfig!.trigger === trigger}
                        onChange={() => setDraft({
                          ...draft,
                          retryConfig: {
                            ...draft.retryConfig!,
                            trigger,
                            // XOÁ actionCodes khi đổi trigger: mã của CALL_STATUS ("NO_ANSWER"), của
                            // CALL_ATTRIBUTE ("BUSY", "REJECTED"…) và của CONTACT_STATUS ("1", "1-1")
                            // thuộc ba danh mục khác hẳn nhau. Giữ lại là gửi lên BE một cấu hình
                            // không bao giờ khớp được gì — hoặc tệ hơn, khớp NHẦM: "NO_ANSWER" tồn
                            // tại ở CẢ CALL_STATUS lẫn CALL_ATTRIBUTE nhưng nghĩa HẸP HƠN ở cái sau.
                            actionCodes: [],
                          },
                        })} />
                      <span>
                        {label}
                        <span className="block text-xs text-(--color-muted)">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          )}
          {draft.retryConfig && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label={`Số lần gọi lại tối đa (${LIMITS.maxRetry.min}–${LIMITS.maxRetry.max})`}>
                <input type="number" min={LIMITS.maxRetry.min} max={LIMITS.maxRetry.max}
                  className={inputClass} value={draft.retryConfig.maxRetry}
                  onChange={(e) => setDraft({ ...draft, retryConfig: { ...draft.retryConfig!, maxRetry: Number(e.target.value) } })} />
              </Field>
              <Field label={draft.retryConfig.maxRetry > 0
                ? `Gọi lại sau (≥ ${LIMITS.delaySeconds.min} giây, từ lúc cuộc kết thúc)`
                : 'Gọi lại sau (không áp dụng khi số lần = 0)'}>
                <input type="number" min={LIMITS.delaySeconds.min}
                  className={inputClass} value={draft.retryConfig.delaySeconds}
                  onChange={(e) => setDraft({ ...draft, retryConfig: { ...draft.retryConfig!, delaySeconds: Number(e.target.value) } })} />
              </Field>
            </div>
          )}
          {draft.retryConfig?.trigger === 'CALL_STATUS' && draft.retryConfig.maxRetry > 0 && (
            <div className="mt-3">
              <Field label="Gọi lại khi kết quả là">
                <div className="flex flex-wrap items-center gap-3">
                  {CALL_STATUS_CODES.map(({ code, label, supported }) => {
                    const checked = (draft.retryConfig?.actionCodes ?? []).includes(code);
                    return (
                      <label key={code}
                        className={`flex items-center gap-1.5 text-sm ${supported ? '' : 'text-(--color-muted)'}`}>
                        <input type="checkbox" checked={checked} disabled={!supported}
                          onChange={() => setDraft({
                            ...draft,
                            retryConfig: {
                              ...draft.retryConfig!,
                              actionCodes: toggleCode(draft.retryConfig?.actionCodes, code),
                            },
                          })} />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </Field>
            </div>
          )}
          {draft.retryConfig?.trigger === 'CALL_ATTRIBUTE' && draft.retryConfig.maxRetry > 0 && (
            <div className="mt-3">
              <Field label="Gọi lại khi kết quả thuộc nhóm">
                <div className="flex flex-wrap items-center gap-3">
                  {CALL_ATTRIBUTE_CODES.map(({ code, label, share, warn }) => {
                    const checked = (draft.retryConfig?.actionCodes ?? []).includes(code);
                    return (
                      <label key={code} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" checked={checked}
                          onChange={() => setDraft({
                            ...draft,
                            retryConfig: {
                              ...draft.retryConfig!,
                              actionCodes: toggleAttributeCode(draft.retryConfig?.actionCodes, code),
                            },
                          })} />
                        {label}
                        <span className={`text-xs ${warn ? 'text-(--color-danger)' : 'text-(--color-muted)'}`}>
                          {share}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </Field>
              <p className="mt-2 text-xs text-(--color-muted)">
                Tỉ lệ bên cạnh là <b>phần trăm cuộc gọi thực tế</b> rơi vào nhóm đó (đo trên dữ liệu
                tháng 8/2026). <b className="text-(--color-danger)">Nhà mạng chặn</b> chiếm gần một
                nửa số cuộc — bật nhóm này là gọi lại rất nhiều, cân nhắc cùng với số lần tối đa.
              </p>
              <p className="mt-1 text-xs text-(--color-muted)">
                Cuộc <b>đã nghe máy</b> không thuộc nhóm nào ở đây — điều kiện này chỉ áp cho cuộc
                không kết nối được.
              </p>
            </div>
          )}
          {draft.retryConfig?.trigger === 'CONTACT_STATUS' && draft.retryConfig.maxRetry > 0 && (
            <div className="mt-3">
              <Field label="Gọi lại khi khách ở trạng thái">
                {contactStatuses.length === 0 ? (
                  <p className="text-xs text-(--color-danger)">
                    Chưa lấy được danh mục trạng thái khách hàng. Kiểm tra token, hoặc tenant chưa
                    cấu hình trạng thái nào trong phần Khách hàng.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto rounded-(--radius-field) border border-(--color-line) p-2">
                    {contactStatuses.map(({ code, name, isSecondLevel }) => {
                      const checked = (draft.retryConfig?.actionCodes ?? []).includes(code);
                      return (
                        <label key={code}
                          className={`flex items-center gap-2 py-1 text-sm ${isSecondLevel ? 'pl-5' : 'font-medium'}`}>
                          <input type="checkbox" checked={checked}
                            onChange={() => setDraft({
                              ...draft,
                              retryConfig: {
                                ...draft.retryConfig!,
                                actionCodes: toggleValue(draft.retryConfig?.actionCodes, code),
                              },
                            })} />
                          {name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </Field>
              <p className="mt-2 text-xs text-(--color-muted)">
                Chọn trạng thái <b>cấp 1</b> là khớp mọi trạng thái con bên trong nó; chọn trạng thái
                con thì chỉ khớp đúng nhánh đó.
              </p>
            </div>
          )}
          {draft.retryConfig?.maxRetry === 0 && (
            <p className="mt-2 text-xs text-(--color-muted)">
              Số lần = 0 nghĩa là <b>tắt gọi lại</b> — backend hiểu đúng như vậy và sẽ không gọi lại lần nào.
            </p>
          )}
          {/* Cảnh báo bám theo TRIGGER ĐANG CHỌN. Bản trước viết chung một câu cho mọi trigger
              ("trạng thái khách hàng sẽ mở dần") và không được sửa khi CONTACT_STATUS chạy thật —
              hệ quả: người dùng vừa chọn xong trạng thái khách thì đọc ngay bên dưới thấy bảo chưa
              hỗ trợ, tưởng cấu hình mình vừa làm là vô nghĩa. Giới hạn nào thì nói đúng lúc đó. */}
          {draft.retryConfig?.trigger === 'CALL_STATUS' && (
            <p className="mt-2 text-xs text-(--color-muted)">
              Hiện backend chỉ thực thi gọi lại khi <b>không nghe máy</b>. Các kết quả khác sẽ mở dần.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );

  function updateSlot(index: number, slot: TimeSlot) {
    setDraft({ ...draft, timeSlots: draft.timeSlots.map((s, i) => (i === index ? slot : s)) });
  }
}

/**
 * Danh mục kết quả cuộc gọi để chọn điều kiện gọi lại.
 *
 * `supported` bám đúng khả năng THẬT của backend, không phải mong muốn: engine cũ chỉ có một đường
 * gọi lại và nó nằm ở nhánh không-nghe-máy, nên các mã còn lại nhận vào cũng không gọi lại lần nào.
 * Hiện đúng — chứ không mở sẵn rồi để người dùng chờ một cuộc gọi không bao giờ tới.
 * Mở thêm mã: đổi `supported` ở đây SAU KHI backend thực thi được mã đó.
 */
const CALL_STATUS_CODES: { code: string; label: string; supported: boolean }[] = [
  { code: 'NO_ANSWER', label: 'Không nghe máy', supported: true },
  { code: 'ANSWER', label: 'Có nghe máy (chưa hỗ trợ)', supported: false },
  { code: 'VOICE_MAIL', label: 'Hộp thư thoại (chưa hỗ trợ)', supported: false },
  { code: 'BUSY', label: 'Máy bận (chưa hỗ trợ)', supported: false },
];

/** Ba nhóm điều kiện gọi lại — loại trừ nhau, đúng 3 radio trên thiết kế. */
const RETRY_TRIGGERS: { trigger: RetryTrigger; label: string; hint: string }[] = [
  {
    trigger: 'CALL_STATUS',
    label: 'Theo trạng thái cuộc gọi',
    hint: 'Mức tổng: Trả lời / Không trả lời. Hiện chỉ thực thi "không trả lời".',
  },
  {
    trigger: 'CALL_ATTRIBUTE',
    label: 'Theo kết quả cuộc gọi',
    hint: 'Mức chi tiết: bận, ngoài vùng phủ sóng, nhà mạng chặn… (map Q.850/FreeSWITCH).',
  },
  {
    trigger: 'CONTACT_STATUS',
    label: 'Theo trạng thái khách hàng',
    hint: 'Theo trạng thái đã gắn cho khách trong phần Khách hàng.',
  },
];

/**
 * Năm nhóm kết quả cuộc gọi của trigger CALL_ATTRIBUTE — khớp
 * `HangupCauseCatalog.supportedCodes()` phía backend. Cả 5 đều thực thi được.
 *
 * `share` là tỉ lệ traffic đo trên CDR production tháng 8/2026 (1,95 triệu cuộc callbot). Hiện lên UI
 * vì chênh lệch giữa các nhóm rất lớn: bật "Nhà mạng chặn" là gọi lại cho ~43% số cuộc, còn bật
 * "Bận" chỉ ~8%. Người dùng cần thấy con số đó TRƯỚC khi tick, không phải sau khi hết tiền cước.
 */
const CALL_ATTRIBUTE_CODES: { code: string; label: string; share: string; warn?: boolean }[] = [
  { code: 'NO_ANSWER', label: 'Không nghe máy', share: '~6%' },
  { code: 'BUSY', label: 'Bận', share: '~8%' },
  { code: 'SUBSCRIBER_UNAVAILABLE', label: 'Ngoài vùng phủ sóng', share: '~18%' },
  { code: 'REJECTED', label: 'Nhà mạng chặn', share: '~45%', warn: true },
  { code: 'UNKNOWN_ERROR', label: 'Lỗi chưa xác định', share: '~2%' },
];

/** Bật/tắt một mã kết quả. Giữ thứ tự theo danh mục để payload ổn định giữa các lần sửa. */
function toggleCode(actionCodes: string[] | undefined, code: string): string[] {
  const current = actionCodes ?? [];
  const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
  return CALL_STATUS_CODES.map((c) => c.code).filter((c) => next.includes(c));
}

/**
 * Như {@link toggleCode} nhưng cho danh mục CALL_ATTRIBUTE.
 *
 * Cố ý là hàm RIÊNG chứ không tổng quát hoá chung một hàm: hai danh mục có mã trùng tên
 * (`NO_ANSWER`) nhưng nghĩa khác nhau, nên lọc nhầm danh mục sẽ âm thầm rụng mã hợp lệ thay vì báo lỗi.
 */
function toggleAttributeCode(actionCodes: string[] | undefined, code: string): string[] {
  const current = actionCodes ?? [];
  const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
  return CALL_ATTRIBUTE_CODES.map((c) => c.code).filter((c) => next.includes(c));
}

/**
 * Bật/tắt một giá trị, giữ nguyên thứ tự người dùng chọn.
 * <p>Khác {@link toggleCode} ở chỗ không sắp lại theo danh mục cố định — danh mục trạng thái khách
 * là động theo tenant nên không có thứ tự chuẩn để bám.
 */
function toggleValue(values: string[] | undefined, value: string): string[] {
  const current = values ?? [];
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}

/** Bật/tắt 1 ngày. daysOfWeek chưa có (slot cũ) = đang chọn cả 7 → bắt đầu từ đủ 7 rồi bỏ ngày này. */
function toggleDay(daysOfWeek: number[] | undefined, day: number): number[] {
  const current = daysOfWeek && daysOfWeek.length > 0 ? daysOfWeek : ALL_DAYS;
  return current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b);
}
