/**
 * Validate cấu hình phiên — gom 1 chỗ để màn Tạo phiên và modal Phân bổ dùng chung.
 *
 * Bám cách AutoCall làm (web-v2 MarketingAutoCallCreateV2.validateData): thu HẾT lỗi vào
 * một map field→message rồi focus field lỗi ĐẦU TIÊN, thay vì bắn toast từng lỗi một.
 *
 * Khác AutoCall ở chỗ: ràng buộc số ở đây lấy đúng bound của BE
 * (ClientSessionConfigValidator) để chặn ngay trên UI, không để BE trả CS_INVALID_CONFIG —
 * người dùng đọc "Cấu hình phiên không hợp lệ" thì không biết sai field nào.
 */
import type { RetryConfig, SipNumber, TimeSlot } from '@/contracts/types';

/** Bound đồng bộ với ClientSessionConfigValidator phía BE — đổi BE thì đổi ở đây. */
export const LIMITS = {
  batchSize: { min: 1, max: 500 },
  batchIntervalSeconds: { min: 10, max: 3600 },
  ringTimeoutSeconds: { min: 5, max: 60 },
  maxCallTimeSeconds: { min: 30, max: 3600 },
  // min = 0 chứ không phải 1: BE coi maxRetry = 0 là "TẮT gọi lại có chủ đích" (RetryConfig
  // .firstInvalidReason cho phép [0,10]) — chặn ở 1 là FE từ chối một cấu hình BE nhận.
  maxRetry: { min: 0, max: 10 },
  delaySeconds: { min: 30 },
} as const;

/** Thứ tự field = thứ tự focus khi có nhiều lỗi (trên xuống dưới đúng như layout). */
export const FIELD_ORDER = [
  'name', 'purpose', 'startTimeLocal', 'sipNumbers', 'ringTimeoutSeconds', 'maxCallTimeSeconds',
  'scriptUuid', 'voiceOverride', 'distribution', 'rows',
] as const;

export type SessionFieldKey = (typeof FIELD_ORDER)[number];
export type FieldErrors = Partial<Record<SessionFieldKey, string>>;

export interface ValidatableForm {
  name: string;
  startTimeLocal: string;
  sipNumbers: SipNumber[];
  scriptUuid: string;
  ringTimeoutSeconds: string;
  maxCallTimeSeconds: string;
  distribution: {
    batchSize: number;
    batchIntervalSeconds: number;
    timeSlots: TimeSlot[];
    retryConfig: RetryConfig | null;
  };
}

/**
 * Validate cho hành động SUBMIT (publish phiên). Lưu nháp thì không cần —
 * BE chỉ đòi `name` khi create, phần còn lại kiểm ở lúc submit.
 */
export function validateForSubmit(form: ValidatableForm, activeRowCount: number): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.name.trim()) {
    errors.name = 'Nhập tên phiên';
  }

  // AutoCall: sendTime < now → "Thời gian gửi không hợp lệ".
  // BE cho phép trễ 60s (START_TIME_GRACE_MS) nên ta nới đúng bằng vậy.
  if (form.startTimeLocal) {
    const startMs = new Date(form.startTimeLocal).getTime();
    if (Number.isNaN(startMs)) {
      errors.startTimeLocal = 'Thời gian gửi không hợp lệ';
    } else if (startMs < Date.now() - 60_000) {
      errors.startTimeLocal = 'Thời gian gửi đã qua — chọn lại mốc trong tương lai';
    }
  }

  if (form.sipNumbers.length === 0) {
    errors.sipNumbers = 'Chọn ít nhất 1 đầu số gọi ra';
  } else {
    // Bẫy thật: BE bắt buộc mỗi đầu số phải có `gateway`, thiếu là submit fail với
    // message khó hiểu. Chặn từ đây và nói rõ phải chọn lại từ danh mục.
    const missingGateway = form.sipNumbers.filter((sip) => !sip.gateway?.trim());
    if (missingGateway.length > 0) {
      errors.sipNumbers = `Đầu số ${missingGateway
        .map((sip) => sip.number)
        .join(', ')} thiếu thông tin gateway — chọn lại từ danh mục đầu số`;
    }
  }

  if (!form.scriptUuid) {
    errors.scriptUuid = 'Chọn kịch bản AI Callbot';
  }

  if (form.ringTimeoutSeconds.trim()) {
    const ring = Number(form.ringTimeoutSeconds);
    const { min, max } = LIMITS.ringTimeoutSeconds;
    if (!Number.isFinite(ring) || ring < min || ring > max) {
      errors.ringTimeoutSeconds = `Thời gian chờ kết nối phải trong ${min}–${max} giây`;
    }
  }

  if (form.maxCallTimeSeconds.trim()) {
    const maxCall = Number(form.maxCallTimeSeconds);
    const { min, max } = LIMITS.maxCallTimeSeconds;
    if (!Number.isFinite(maxCall) || maxCall < min || maxCall > max) {
      errors.maxCallTimeSeconds = `Thời lượng cuộc tối đa phải trong ${min}–${max} giây`;
    }
  }

  const distributionError = validateDistribution(form.distribution);
  if (distributionError) {
    errors.distribution = distributionError;
  }

  // AutoCall: !isArray(content['sendList']) → "Chưa có khách hàng".
  // BE cũng chặn ở submit bằng CS_NO_DATA, nhưng chặn sớm thì đỡ mất 1 vòng request.
  if (activeRowCount === 0) {
    errors.rows = 'Chưa nạp khách hàng nào — thêm bằng Thủ công, File Excel hoặc Thuộc tính khách hàng';
  }

  return errors;
}

/**
 * Validate riêng khối phân bổ. Trả về message đầu tiên (hoặc null) — dùng cho cả
 * modal Phân bổ và dòng lỗi tóm tắt ngoài màn Tạo phiên.
 */
export function validateDistribution(distribution: ValidatableForm['distribution']): string | null {
  const { batchSize, batchIntervalSeconds, timeSlots, retryConfig } = distribution;

  if (!Number.isFinite(batchSize) || batchSize < LIMITS.batchSize.min || batchSize > LIMITS.batchSize.max) {
    return `Số cuộc mỗi lần phân bổ phải trong ${LIMITS.batchSize.min}–${LIMITS.batchSize.max}`;
  }
  if (
    !Number.isFinite(batchIntervalSeconds)
    || batchIntervalSeconds < LIMITS.batchIntervalSeconds.min
    || batchIntervalSeconds > LIMITS.batchIntervalSeconds.max
  ) {
    return `Chu kỳ phân bổ phải trong ${LIMITS.batchIntervalSeconds.min}–${LIMITS.batchIntervalSeconds.max} giây`;
  }

  for (const slot of timeSlots) {
    if (!/^\d{2}:\d{2}$/.test(slot.from) || !/^\d{2}:\d{2}$/.test(slot.to)) {
      return 'Khung giờ phải ở dạng HH:mm';
    }
    if (slot.from >= slot.to) {
      return `Khung giờ ${slot.from} - ${slot.to}: giờ bắt đầu phải trước giờ kết thúc`;
    }
    // BE hiểu daysOfWeek rỗng = MỌI NGÀY, còn người dùng bỏ hết ngày lại nghĩ là "tắt khung này".
    // Không chặn ở đây thì phiên chạy cả tuần trong khi người dùng tưởng đã tắt.
    if (slot.daysOfWeek && slot.daysOfWeek.length === 0) {
      return `Khung giờ ${slot.from} - ${slot.to}: chọn ít nhất 1 ngày trong tuần`;
    }
  }

  if (overlappingSlots(timeSlots)) {
    return 'Có hai khung giờ trùng nhau trong cùng một ngày — gộp lại cho rõ ràng';
  }

  // Bám đúng RetryConfig.firstInvalidReason() của BE: trigger rỗng = không cấu hình gọi lại
  // (hợp lệ); delaySeconds chỉ bị đòi khi maxRetry > 0; BOT_ACTION bắt buộc có actionCodes.
  if (retryConfig?.trigger) {
    const { trigger, actionCodes, maxRetry, delaySeconds } = retryConfig;
    if (!Number.isFinite(maxRetry) || maxRetry < LIMITS.maxRetry.min || maxRetry > LIMITS.maxRetry.max) {
      return `Số lần gọi lại tối đa phải trong ${LIMITS.maxRetry.min}–${LIMITS.maxRetry.max}`;
    }
    if (maxRetry > 0 && (!Number.isFinite(delaySeconds) || delaySeconds < LIMITS.delaySeconds.min)) {
      return `Thời gian chờ gọi lại tối thiểu ${LIMITS.delaySeconds.min} giây`;
    }
    if (trigger === 'BOT_ACTION' && (actionCodes?.length ?? 0) === 0) {
      return 'Gọi lại theo hành vi callbot phải chọn ít nhất 1 action';
    }
  }

  return null;
}

/** Hai khung giờ chồng nhau và có ít nhất 1 ngày chung — AutoCall không kiểm, ta kiểm thêm. */
function overlappingSlots(timeSlots: TimeSlot[]): boolean {
  const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
  const daysOf = (slot: TimeSlot) =>
    !slot.daysOfWeek || slot.daysOfWeek.length === 0 ? ALL_DAYS : slot.daysOfWeek;

  for (let i = 0; i < timeSlots.length; i += 1) {
    for (let j = i + 1; j < timeSlots.length; j += 1) {
      const a = timeSlots[i];
      const b = timeSlots[j];
      const sharesDay = daysOf(a).some((day) => daysOf(b).includes(day));
      if (sharesDay && a.from < b.to && b.from < a.to) return true;
    }
  }
  return false;
}

/** Lỗi đầu tiên theo thứ tự layout — để scroll/focus đúng field người dùng thấy trước. */
export function firstErrorField(errors: FieldErrors): SessionFieldKey | null {
  return FIELD_ORDER.find((field) => errors[field]) ?? null;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
