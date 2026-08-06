'use client';
/**
 * Chọn nhiều giá trị từ danh mục phân loại KH (thẻ / nhóm KH / loại hình).
 *
 * Trước đây tab "Thuộc tính khách hàng" bắt người dùng TỰ GÕ id (`tag_vip, cat_1`) vào ô text —
 * thực tế không ai biết id của mình nên tính năng gần như không dùng được. Giờ chọn từ danh mục
 * thật, hiện tên + màu như app OMICRM.
 *
 * Hỗ trợ danh mục 2 cấp (nhóm KH có cấp con): cấp con thụt lề, chọn độc lập với cấp cha —
 * giống SelectClassify của web-v2, không tự động chọn kèm cha/con.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClassifyOption } from '@/lib/catalogApi';

export function ClassifyPicker({
  label, options, selected, onChange, loading, error, onRetry, emptyHint,
}: {
  label: string;
  options: ClassifyOption[];
  /** Danh sách id đang chọn. */
  selected: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  /** Làm phẳng cây thành danh sách phẳng có mức thụt lề, để lọc/render một vòng. */
  const flat = useMemo(() => flatten(options), [options]);

  const visible = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return flat;
    return flat.filter((item) => item.name.toLowerCase().includes(needle));
  }, [flat, keyword]);

  const byId = useMemo(() => new Map(flat.map((item) => [item.id, item])), [flat]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div className="text-sm">
      <span className="mb-1 block text-xs text-(--color-muted)">{label}</span>
      <div className="relative" ref={boxRef}>
        <div role="button" tabIndex={0} aria-expanded={open}
          onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
          className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg border border-(--color-line) bg-(--color-field) px-3 py-2">
          {selected.length === 0 ? (
            <span className="text-(--color-muted)">
              {loading && options.length === 0 ? 'Đang tải…' : 'Tất cả'}
            </span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {selected.map((id) => {
                const item = byId.get(id);
                return (
                  <span key={id}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-0.5 text-[13px] font-medium ring-1 ring-(--color-line)">
                    {item?.color && (
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                    )}
                    {item?.name ?? id}
                    <button type="button" title="Bỏ chọn" className="hover:opacity-60"
                      onClick={(e) => { e.stopPropagation(); toggle(id); }}>×</button>
                  </span>
                );
              })}
            </span>
          )}
          <span className="ml-auto text-xs text-(--color-muted)">▾</span>
        </div>

        {open && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-(--color-line) bg-white shadow-lg">
            <div className="border-b border-(--color-line) p-2">
              <input autoFocus value={keyword} onChange={(e) => setKeyword(e.target.value)}
                placeholder="Tìm…"
                className="w-full rounded-lg bg-(--color-field) px-2.5 py-1.5 text-sm outline-none" />
            </div>
            <div className="max-h-56 overflow-auto">
              {visible.length === 0 && (
                <div className="px-3 py-2.5 text-sm text-(--color-muted)">
                  {loading ? 'Đang tải…' : keyword ? 'Không có kết quả' : emptyHint ?? 'Danh mục trống'}
                </div>
              )}
              {visible.map((item) => {
                const isSelected = selected.includes(item.id);
                return (
                  <button key={item.id} type="button" onClick={() => toggle(item.id)}
                    style={{ paddingLeft: 12 + item.depth * 16 }}
                    className="flex w-full items-center gap-2.5 py-2 pr-3 text-left text-sm hover:bg-(--color-field)">
                    <span aria-hidden
                      className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border text-[11px] ${
                        isSelected
                          ? 'border-(--color-primary) bg-(--color-primary) text-white'
                          : 'border-(--color-line) bg-white text-transparent'}`}>✓</span>
                    {item.color && (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                    )}
                    <span className="min-w-0 truncate">{item.name}</span>
                  </button>
                );
              })}
            </div>
            {selected.length > 0 && (
              <div className="border-t border-(--color-line) px-3 py-2">
                <button type="button" className="text-xs text-(--color-link) hover:underline"
                  onClick={() => onChange([])}>
                  Bỏ chọn tất cả ({selected.length})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          {onRetry && (
            <button type="button" className="shrink-0 underline hover:opacity-70" onClick={onRetry}>Thử lại</button>
          )}
        </div>
      )}
    </div>
  );
}

interface FlatItem { id: string; name: string; color?: string; depth: number }

function flatten(options: ClassifyOption[], depth = 0): FlatItem[] {
  const out: FlatItem[] = [];
  for (const option of options) {
    out.push({ id: option.id, name: option.name, color: option.color, depth });
    if (option.children?.length) out.push(...flatten(option.children, depth + 1));
  }
  return out;
}
