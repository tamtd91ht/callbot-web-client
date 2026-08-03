'use client';
/**
 * UI primitives theo design tokens template OmiCall (globals.css @theme).
 * Cố ý KHÔNG dùng component-lib — style khớp ảnh mẫu: input filled label bên trong,
 * nút primary xanh lá, card trắng bo 12px, drawer trượt phải.
 */
import { type ReactNode, useEffect } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-(--radius-card) border border-(--color-line) bg-white p-5 ${className}`}>{children}</div>;
}

export function Button({
  children, onClick, variant = 'outline', disabled, type = 'button', className = '',
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'; type?: 'button' | 'submit'; className?: string;
}) {
  const styles = {
    primary: 'bg-(--color-primary) text-white hover:bg-(--color-primary-dark) border-transparent',
    outline: 'bg-white text-(--color-ink) border-(--color-line) hover:bg-gray-50',
    ghost: 'bg-transparent border-transparent text-(--color-link) hover:underline',
    danger: 'bg-white text-(--color-danger) border-(--color-line) hover:bg-red-50',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${styles} ${className}`}>
      {children}
    </button>
  );
}

/** Input filled với label nhỏ BÊN TRONG field — đúng kiểu template. */
export function Field({
  label, required, children, highlight = false, className = '',
}: { label: string; required?: boolean; children: ReactNode; highlight?: boolean; className?: string }) {
  return (
    <label className={`block rounded-(--radius-field) border px-4 py-2 ${
      highlight ? 'border-sky-200 bg-sky-50' : 'border-transparent bg-(--color-field)'} ${className}`}>
      <span className="block text-xs text-(--color-muted)">
        {label} {required && <span className="text-(--color-danger)">*</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass = 'w-full bg-transparent text-[15px] text-(--color-ink) outline-none placeholder:text-gray-400';

export function Modal({
  open, title, onClose, children, footer, width = 'max-w-xl',
}: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`w-full ${width} rounded-2xl bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-(--color-line) px-6 py-4">
          <h3 className="text-base font-bold">{title}</h3>
          <button onClick={onClose} className="text-2xl leading-none text-(--color-muted) hover:text-black">×</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex gap-3 border-t border-(--color-line) px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/** Drawer trượt từ phải — như modal "Thêm khách hàng" img_1. */
export function Drawer({
  open, onClose, children, width = 'w-[860px]',
}: { open: boolean; onClose: () => void; children: ReactNode; width?: string }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <button onClick={onClose}
        className="absolute right-[calc(min(860px,92vw)+16px)] top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow">
        ×
      </button>
      <div className={`absolute right-0 top-0 h-full ${width} max-w-[92vw] overflow-hidden rounded-l-2xl bg-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Tabs({
  tabs, active, onChange,
}: { tabs: Array<{ key: string; label: ReactNode }>; active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex gap-8 border-b border-(--color-line) px-6 pt-4">
      {tabs.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={`pb-3 text-[15px] font-semibold transition ${
            active === tab.key ? 'border-b-2 border-(--color-navy) text-(--color-ink)' : 'text-(--color-muted) hover:text-(--color-ink)'}`}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  children, active, onClick,
}: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3.5 py-1 text-[13px] font-medium transition ${
        active ? 'bg-(--color-navy) text-white' : 'bg-(--color-field) text-(--color-ink) hover:bg-gray-200'}`}>
      {children}
    </button>
  );
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
}
