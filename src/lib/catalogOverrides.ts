'use client';
/**
 * Danh mục do NGƯỜI DÙNG tự nhập, lưu localStorage.
 *
 * Vì sao cần: kịch bản (`scriptUuid`) và đầu số là DỮ LIỆU CỦA TENANT trên backend, mà app này
 * chưa có API danh mục để lấy về. Giá trị mock trong `catalogs.ts` không tồn tại trên backend thật
 * → submit sẽ ăn `CS_SCRIPT_NOT_FOUND` hoặc gọi ra số không có thật. Nên UI cho nhập tay giá trị
 * thật (lấy từ màn kịch bản/đầu số của OmiCRM), nhập một lần rồi dùng mãi — cùng cách làm với token.
 *
 * Khi BE mở API danh mục thì thay phần đọc ở `useCatalogs()`, phần override này vẫn dùng được
 * cho trường hợp muốn test một giá trị chưa có trong danh sách.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SipNumber } from '@/contracts/types';

const STORAGE_KEY = 'callbot.catalogOverrides';
export const CATALOG_CHANGED_EVENT = 'callbot-catalog-changed';

export interface ScriptOption { uuid: string; name: string }

export interface CatalogOverrides {
  scripts: ScriptOption[];
  sipNumbers: SipNumber[];
  voices: string[];
}

const EMPTY: CatalogOverrides = { scripts: [], sipNumbers: [], voices: [] };

export function readOverrides(): CatalogOverrides {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<CatalogOverrides>;
    return {
      scripts: parsed.scripts ?? [],
      sipNumbers: parsed.sipNumbers ?? [],
      voices: parsed.voices ?? [],
    };
  } catch {
    return EMPTY; // localStorage hỏng thì coi như chưa có gì, không làm vỡ màn hình
  }
}

function write(next: CatalogOverrides): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CATALOG_CHANGED_EVENT));
}

export function addScript(script: ScriptOption): void {
  const current = readOverrides();
  if (current.scripts.some((s) => s.uuid === script.uuid)) return;
  write({ ...current, scripts: [...current.scripts, script] });
}

export function addSipNumber(sip: SipNumber): void {
  const current = readOverrides();
  if (current.sipNumbers.some((s) => s.number === sip.number)) return;
  write({ ...current, sipNumbers: [...current.sipNumbers, sip] });
}

export function addVoice(value: string): void {
  const current = readOverrides();
  if (!value || current.voices.includes(value)) return;
  write({ ...current, voices: [...current.voices, value] });
}

export function removeScript(uuid: string): void {
  const current = readOverrides();
  write({ ...current, scripts: current.scripts.filter((s) => s.uuid !== uuid) });
}

export function removeSipNumber(number: string): void {
  const current = readOverrides();
  write({ ...current, sipNumbers: current.sipNumbers.filter((s) => s.number !== number) });
}

export function removeVoice(value: string): void {
  const current = readOverrides();
  write({ ...current, voices: current.voices.filter((v) => v !== value) });
}

/** Đồng bộ nhiều component đang mở cùng lúc (và cả tab khác qua event `storage`). */
export function useCatalogOverrides(): CatalogOverrides {
  const [overrides, setOverrides] = useState<CatalogOverrides>(EMPTY);
  const sync = useCallback(() => setOverrides(readOverrides()), []);

  useEffect(() => {
    sync();
    window.addEventListener(CATALOG_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CATALOG_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [sync]);

  return overrides;
}
