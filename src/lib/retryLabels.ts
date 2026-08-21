/**
 * Nhãn mô tả cấu hình gọi lại — dùng chung cho mọi chỗ hiển thị (màn tạo phiên, dialog xác nhận,
 * panel cấu hình). Gom một chỗ vì trước đây ba nơi cùng ghi cứng "khi không nghe máy", nên khi
 * điều kiện gọi lại trở thành thứ CHỌN ĐƯỢC thì cả ba đều mô tả sai cấu hình thật.
 */
import type { RetryCondition, RetryConfig } from '@/contracts/types';

/**
 * [2026-08-21] Quy CẢ HAI dạng cấu hình về một list điều kiện — bản chiếu của
 * `RetryConfig.effectiveConditions()` phía BE. Mọi chỗ ĐỌC cấu hình (hiển thị, validate, mock)
 * phải đi qua đây, đọc thẳng `retry.trigger`/`retry.conditions` là sẽ quên một dạng.
 */
export function effectiveRetryConditions(retry: RetryConfig): RetryCondition[] {
  if (retry.conditions && retry.conditions.length > 0) return retry.conditions;
  if (retry.trigger) return [{ trigger: retry.trigger, actionCodes: retry.actionCodes }];
  return [];
}

/** Mã của trigger CALL_STATUS — mức TỔNG (nghe máy / không nghe máy). */
const CODE_LABELS: Record<string, string> = {
  NO_ANSWER: 'không nghe máy',
  ANSWER: 'có nghe máy',
  VOICE_MAIL: 'hộp thư thoại',
  BUSY: 'máy bận',
};

/**
 * Nhãn nhóm của trigger CALL_ATTRIBUTE — mức CHI TIẾT, quy từ hangup cause Q.850/FreeSWITCH.
 *
 * ⚠️ Phải là bảng RIÊNG, không gộp vào `CODE_LABELS`: mã `NO_ANSWER` tồn tại ở CẢ HAI danh mục với
 * nghĩa khác nhau (ở đây HẸP hơn — không gồm máy bận / ngoài vùng phủ sóng). Gộp chung thì mô tả sẽ
 * đúng chữ nhưng sai nghĩa, mà sai kiểu đó không ai nhìn ra vì câu vẫn đọc trôi.
 */
const ATTRIBUTE_LABELS: Record<string, string> = {
  NO_ANSWER: 'không nghe máy',
  BUSY: 'bận',
  SUBSCRIBER_UNAVAILABLE: 'ngoài vùng phủ sóng',
  REJECTED: 'nhà mạng chặn',
  UNKNOWN_ERROR: 'lỗi chưa xác định',
  VOICE_MAIL: 'voicemail',
  NUMBER_NOT_EXIST: 'thuê bao không tồn tại, tạm khoá',
  CALL_BARRED: 'thuê bao chặn cuộc gọi',
};

/**
 * Ví dụ: "Khi không nghe máy". Mã lạ (BE mở thêm sau) hiện nguyên văn thay vì bị nuốt mất.
 *
 * [2026-08-21] Nhiều điều kiện (OR): mô tả từng điều kiện rồi nối bằng "HOẶC" — đúng ngữ nghĩa
 * thực thi (một điều kiện khớp là gọi lại). Vẫn nhận dạng cũ 1 điều kiện qua
 * {@link effectiveRetryConditions}.
 *
 * @param statusNames tra mã trạng thái khách ("1", "1-1") → tên. Không truyền thì mô tả chung chung
 *   thay vì phơi mã thô — "1-1" với người dùng là vô nghĩa.
 */
export function describeRetryCondition(
  retry: RetryConfig,
  statusNames?: Map<string, string>,
): string {
  const conditions = effectiveRetryConditions(retry);
  if (conditions.length === 0) return 'Chưa chọn điều kiện';
  const text = conditions.map((c) => describeOne(c, statusNames)).join(' HOẶC ');
  // Viết hoa chữ đầu — caller đang ghép "<mô tả> — tối đa N lần" nên chuỗi phải tự đứng được.
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function describeOne(condition: RetryCondition, statusNames?: Map<string, string>): string {
  if (condition.trigger === 'CONTACT_ATTRIBUTE') return 'theo thuộc tính khách hàng';
  const codes = condition.actionCodes ?? [];
  if (condition.trigger === 'CONTACT_STATUS') {
    if (codes.length === 0) return 'chưa chọn trạng thái';
    const named = codes.map((c) => statusNames?.get(c.trim())).filter((n): n is string => !!n);
    // Chỉ hiện tên khi tra được ĐỦ: thiếu một cái mà vẫn liệt kê là mô tả sai cấu hình thật.
    return named.length === codes.length
      ? `khi khách ở trạng thái ${named.join(', ')}`
      : `theo trạng thái khách hàng (${codes.length} trạng thái)`;
  }
  if (codes.length === 0) return 'chưa chọn điều kiện';
  // Mỗi trigger tra ĐÚNG bảng của nó — xem cảnh báo ở ATTRIBUTE_LABELS.
  const labels = condition.trigger === 'CALL_ATTRIBUTE' ? ATTRIBUTE_LABELS : CODE_LABELS;
  return `khi ${codes.map((c) => labels[c.trim().toUpperCase()] ?? c).join(', ')}`;
}
