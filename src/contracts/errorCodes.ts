/** Error codes CS_* — mirror docs 05 §4; message tiếng Việt gợi ý cho UX (docs 09 §2). */
export const CS_ERROR_MESSAGES: Record<string, string> = {
  CS_NOT_FOUND: 'Không tìm thấy phiên',
  CS_INVALID_STATE: 'Trạng thái phiên đã thay đổi — tải lại trang',
  CS_INVALID_CONFIG: 'Cấu hình phiên không hợp lệ',
  CS_IMPORT_RUNNING: 'Đang import/tính lại dữ liệu — vui lòng đợi xong',
  CS_NO_DATA: 'Phiên chưa có dòng dữ liệu hợp lệ nào',
  CS_SCRIPT_NOT_FOUND: 'Không tìm thấy kịch bản',
  CS_SCRIPT_DELETED: 'Kịch bản đã bị xoá',
  CS_LIMIT_RUNNING_SESSIONS: 'Đã đạt giới hạn số phiên chạy đồng thời',
  CS_TENANT_NOT_FOUND: 'Không tìm thấy doanh nghiệp',
  CS_RUNTIME_CREATE_FAILED: 'Khởi tạo phiên chạy thất bại — thử lại',
  CS_RUNTIME_MISSING: 'Phiên chạy không còn tồn tại — liên hệ hỗ trợ',
  CS_RATE_LIMITED: 'Thao tác quá nhanh — đợi 5 phút giữa các lần tiếp tục phiên',
  CS_AI_INCIDENT: 'Hệ thống AI đang gặp sự cố — thử lại sau ít phút',
  CS_VERSION_CONFLICT: 'Người khác vừa sửa phiên này — tải lại bản mới nhất',
  CS_FILE_TOO_LARGE: 'File vượt quá dung lượng cho phép (20MB)',
  CS_FILE_INVALID_FORMAT: 'File sai định dạng — dùng template .xlsx',
  CS_FILE_TOO_MANY_ROWS: 'File vượt quá 100.000 dòng — tách nhỏ file',
  CS_ROW_NOT_EDITABLE: 'Dòng đã vào hàng đợi gọi — không sửa được',
};

export function errorMessage(errorCode: string | undefined, fallback: string): string {
  return (errorCode && CS_ERROR_MESSAGES[errorCode]) || fallback;
}
