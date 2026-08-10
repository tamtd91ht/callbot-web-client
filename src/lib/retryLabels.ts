/**
 * Nhãn mô tả cấu hình gọi lại — dùng chung cho mọi chỗ hiển thị (màn tạo phiên, dialog xác nhận,
 * panel cấu hình). Gom một chỗ vì trước đây ba nơi cùng ghi cứng "khi không nghe máy", nên khi
 * điều kiện gọi lại trở thành thứ CHỌN ĐƯỢC thì cả ba đều mô tả sai cấu hình thật.
 */
import type { RetryConfig } from '@/contracts/types';

const CODE_LABELS: Record<string, string> = {
  NO_ANSWER: 'không nghe máy',
  ANSWER: 'có nghe máy',
  VOICE_MAIL: 'hộp thư thoại',
  BUSY: 'máy bận',
};

/**
 * Ví dụ: "Khi không nghe máy". Mã lạ (BE mở thêm sau) hiện nguyên văn thay vì bị nuốt mất.
 *
 * @param statusNames tra mã trạng thái khách ("1", "1-1") → tên. Không truyền thì mô tả chung chung
 *   thay vì phơi mã thô — "1-1" với người dùng là vô nghĩa.
 */
export function describeRetryCondition(
  retry: RetryConfig,
  statusNames?: Map<string, string>,
): string {
  if (retry.trigger === 'CONTACT_ATTRIBUTE') return 'Theo thuộc tính khách hàng';
  const codes = retry.actionCodes ?? [];
  if (retry.trigger === 'CONTACT_STATUS') {
    if (codes.length === 0) return 'Chưa chọn trạng thái';
    const named = codes.map((c) => statusNames?.get(c.trim())).filter((n): n is string => !!n);
    // Chỉ hiện tên khi tra được ĐỦ: thiếu một cái mà vẫn liệt kê là mô tả sai cấu hình thật.
    return named.length === codes.length
      ? `Khi khách ở trạng thái ${named.join(', ')}`
      : `Theo trạng thái khách hàng (${codes.length} trạng thái)`;
  }
  if (codes.length === 0) return 'Chưa chọn điều kiện';
  return `Khi ${codes.map((c) => CODE_LABELS[c.trim().toUpperCase()] ?? c).join(', ')}`;
}
