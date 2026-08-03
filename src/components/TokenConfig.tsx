'use client';
/**
 * Nút cấu hình token trên thanh header (chỉ hiện ở REAL mode) — app không có luồng auth
 * nên user paste JWT stg vào đây; token hết hạn thì mở lại dán token mới.
 * Lưu localStorage (lib/token.ts), apiClient tự đính header x-callbot-token cho BFF.
 */
import { useEffect, useState } from 'react';
import { Button, Modal } from '@/components/ui';
import { clearToken, getToken, normalizeToken, setToken, tokenExpiryMs, TOKEN_CHANGED_EVENT } from '@/lib/token';

function expiryLabel(token: string): { text: string; expired: boolean } | null {
  const expMs = tokenExpiryMs(token);
  if (expMs == null) return null;
  const expired = expMs <= Date.now();
  const time = new Date(expMs).toLocaleString('vi-VN');
  return { text: expired ? `Đã hết hạn lúc ${time}` : `Hết hạn lúc ${time}`, expired };
}

export function TokenConfig() {
  const [token, setTokenState] = useState('');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  // đọc localStorage sau mount (tránh hydration mismatch) + nghe thay đổi từ tab khác
  useEffect(() => {
    const sync = () => setTokenState(getToken());
    sync();
    window.addEventListener(TOKEN_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TOKEN_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const expiry = token ? expiryLabel(token) : null;
  const missing = !token;
  const badTone = missing || expiry?.expired;

  const openModal = () => {
    setDraft(token);
    setOpen(true);
  };
  const save = () => {
    setToken(draft);
    setOpen(false);
  };

  const draftExpiry = normalizeToken(draft) ? expiryLabel(normalizeToken(draft)) : null;

  return (
    <>
      <button onClick={openModal}
        className={`rounded-full px-3 py-0.5 text-xs transition hover:bg-white/25 ${
          badTone ? 'bg-amber-500/80 text-white' : 'bg-white/15 text-white'}`}>
        {missing ? '⚠ Chưa có token' : expiry?.expired ? '⚠ Token hết hạn' : '🔑 Token ✓'}
      </button>

      <Modal open={open} title="Token gọi API stg (Authorization Bearer)" onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="primary" onClick={save} disabled={!normalizeToken(draft)}>Lưu token</Button>
            <Button onClick={() => setOpen(false)}>Đóng</Button>
            {token && (
              <Button variant="danger" className="ml-auto" onClick={() => { clearToken(); setDraft(''); setOpen(false); }}>
                Xoá token
              </Button>
            )}
          </>
        }>
        <p className="mb-3 text-sm text-(--color-muted)">
          App không có luồng đăng nhập — mọi request tới <b>callbot-v2-stg.omicrm.com</b> dùng token bạn dán ở đây
          (header <code>Authorization: Bearer …</code>). Lấy token: đăng nhập{' '}
          <a href="https://call-bot-stg.omicrm.com" target="_blank" rel="noreferrer" className="text-(--color-link) underline">call-bot-stg.omicrm.com</a>
          {' '}→ DevTools → Network → copy header <code>Authorization</code>. Token hết hạn thì mở lại đây dán token mới.
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          placeholder='Paste token vào đây — chấp nhận cả "Bearer eyJ..." lẫn token trần'
          className="w-full rounded-(--radius-field) border border-(--color-line) bg-(--color-field) p-3 font-mono text-xs text-(--color-ink) outline-none focus:border-(--color-primary)"
        />
        {draftExpiry && (
          <p className={`mt-2 text-xs ${draftExpiry.expired ? 'text-(--color-danger)' : 'text-(--color-muted)'}`}>
            {draftExpiry.expired ? '⚠ ' : ''}{draftExpiry.text}
          </p>
        )}
      </Modal>
    </>
  );
}
