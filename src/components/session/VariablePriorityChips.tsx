'use client';
/** Chips kéo-thả "Thứ tự ưu tiên giá trị biến" (template img_3) — HTML5 DnD, không thêm lib. */
import { useRef, useState } from 'react';
import { VARIABLE_SOURCES } from './catalogs';

export function VariablePriorityChips({
  order, onChange,
}: { order: string[]; onChange: (order: string[]) => void }) {
  const items = order.length ? order : VARIABLE_SOURCES.map((s) => s.key);
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function drop(target: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from === null || from === target) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-[15px] font-bold">Thứ tự ưu tiên giá trị biến</h4>
        <span className="text-sm text-(--color-muted)">Kéo thả để thay đổi thứ tự</span>
      </div>
      <p className="mb-3 text-[13px] leading-5 text-(--color-muted)">
        Đối với nội dung chứa biến liên kết, hệ thống sẽ ưu tiên lấy giá trị của biến theo thứ tự ưu tiên
        bên dưới. Nếu trường cần ưu tiên không mang giá trị, hệ thống sẽ lấy giá trị của trường ưu tiên kế tiếp.
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((key, index) => {
          const label = VARIABLE_SOURCES.find((s) => s.key === key)?.label ?? key;
          return (
            <div key={key} draggable
              onDragStart={() => { dragIndex.current = index; }}
              onDragOver={(e) => { e.preventDefault(); setOverIndex(index); }}
              onDragLeave={() => setOverIndex((v) => (v === index ? null : v))}
              onDrop={() => drop(index)}
              className={`cursor-grab select-none rounded-lg border px-4 py-2 text-sm font-medium transition active:cursor-grabbing ${
                overIndex === index ? 'border-(--color-primary) bg-(--color-primary-soft)' : 'border-(--color-line) bg-(--color-field)'}`}>
              <span className="mr-2 text-(--color-muted)">⠿</span>{index + 1}. {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
