'use client';
/**
 * Nguồn danh mục cho màn Lên phiên, theo thứ tự ưu tiên:
 *   1. API thật (real mode)      — 3 gateway OmiCRM, xem `catalogApi.ts`
 *   2. Giá trị user tự nhập      — localStorage, vẫn giữ làm đường thoát khi API lỗi/thiếu quyền
 *   3. Mock                      — chỉ dùng ở mock mode; ở real mode hiện kèm nhãn "mock"
 *
 * Vì sao giữ cả 3: API danh mục nằm ở service khác (chatbot-gateway, pbx) nên có thể 401/500 độc lập
 * với callbot-service. Khi đó user vẫn phải tạo được phiên bằng cách dán tay UUID/đầu số,
 * thay vì bị chặn cứng.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SipNumber } from '@/contracts/types';
import { CatalogError, fetchScripts, fetchSipNumbers, fetchVoices, type VoiceOption } from './catalogApi';
import { useCatalogOverrides, type ScriptOption } from './catalogOverrides';
import { IS_REAL } from './sessionApi';
import { getToken, TOKEN_CHANGED_EVENT } from './token';

export interface CatalogState {
  scripts: ScriptOption[];
  sipNumbers: SipNumber[];
  voices: VoiceOption[];
  /** true khi danh sách đến từ API thật (dùng để ẩn nhãn "mock"). */
  fromApi: { scripts: boolean; sipNumbers: boolean; voices: boolean };
  loading: boolean;
  /** Lỗi theo từng danh mục — 3 API độc lập nên 1 cái chết không được che 2 cái kia. */
  errors: { scripts?: string; sipNumbers?: string; voices?: string };
  reload: () => void;
}

function messageOf(e: unknown): string {
  return e instanceof CatalogError || e instanceof Error ? e.message : String(e);
}

export function useCatalogs(): CatalogState {
  const overrides = useCatalogOverrides();
  const [api, setApi] = useState<{
    scripts: ScriptOption[]; sipNumbers: SipNumber[]; voices: VoiceOption[];
  }>({ scripts: [], sipNumbers: [], voices: [] });
  const [errors, setErrors] = useState<CatalogState['errors']>({});
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!IS_REAL || !getToken()) return; // mock mode / chưa dán token thì không gọi API
    let alive = true;
    setLoading(true);
    void (async () => {
      const [scripts, sipNumbers, voices] = await Promise.allSettled([
        fetchScripts(), fetchSipNumbers(), fetchVoices(),
      ]);
      if (!alive) return;
      const nextErrors: CatalogState['errors'] = {};
      const unparsedNote = (name: string, raw?: string) =>
        raw ? `${name}: gọi được API nhưng không đọc được field. Mẫu response: ${raw}` : undefined;

      setApi({
        scripts: scripts.status === 'fulfilled' ? scripts.value.items : [],
        sipNumbers: sipNumbers.status === 'fulfilled' ? sipNumbers.value.items : [],
        voices: voices.status === 'fulfilled' ? voices.value.items : [],
      });
      if (scripts.status === 'rejected') nextErrors.scripts = messageOf(scripts.reason);
      else nextErrors.scripts = unparsedNote('Kịch bản', scripts.value.unparsed);
      if (sipNumbers.status === 'rejected') nextErrors.sipNumbers = messageOf(sipNumbers.reason);
      else nextErrors.sipNumbers = unparsedNote('Đầu số', sipNumbers.value.unparsed);
      if (voices.status === 'rejected') nextErrors.voices = messageOf(voices.reason);
      else nextErrors.voices = unparsedNote('Giọng đọc', voices.value.unparsed);

      setErrors(nextErrors);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [tick]);

  // Dán token mới thì tải lại danh mục ngay, không phải F5
  useEffect(() => {
    const onToken = () => reload();
    window.addEventListener(TOKEN_CHANGED_EVENT, onToken);
    return () => window.removeEventListener(TOKEN_CHANGED_EVENT, onToken);
  }, [reload]);

  const mergeById = <T,>(apiItems: T[], saved: T[], key: (item: T) => string): T[] => {
    const seen = new Set(apiItems.map(key));
    return [...apiItems, ...saved.filter((s) => !seen.has(key(s)))];
  };

  return {
    scripts: mergeById(api.scripts, overrides.scripts, (s) => s.uuid),
    sipNumbers: mergeById(api.sipNumbers, overrides.sipNumbers, (s) => s.number),
    voices: mergeById(api.voices, overrides.voices.map((v) => ({ value: v, label: v })), (v) => v.value),
    fromApi: {
      scripts: api.scripts.length > 0,
      sipNumbers: api.sipNumbers.length > 0,
      voices: api.voices.length > 0,
    },
    loading,
    errors,
    reload,
  };
}
