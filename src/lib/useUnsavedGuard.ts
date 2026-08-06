'use client';
/**
 * Chặn mất cấu hình chưa lưu — tương đương setCrudChanged/toggleCrudChangedDialog của AutoCall
 * (web-v2 gắn cờ "crudChanged" mỗi lần đổi field, rồi hỏi lại khi đóng tab/chuyển tab).
 *
 * Hai lớp:
 *  1. beforeunload  → chặn đóng/refresh tab (browser tự hiện hộp thoại, không sửa được nội dung).
 *  2. confirmLeave() → dùng cho điều hướng trong app (nút "Đóng"), tự hỏi bằng confirm().
 */
import { useCallback, useEffect } from 'react';

export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome bỏ qua returnValue nhưng vẫn cần set để các browser cũ hiện hộp thoại
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const confirmLeave = useCallback(
    (message = 'Cấu hình chưa lưu sẽ bị mất. Bạn vẫn muốn rời khỏi màn này?') =>
      !dirty || window.confirm(message),
    [dirty],
  );

  return { confirmLeave };
}
