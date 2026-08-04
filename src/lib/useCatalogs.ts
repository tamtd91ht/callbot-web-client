'use client';
/**
 * Danh mục cho màn Lên phiên — real mode lấy DUY NHẤT từ 3 gateway OmiCRM
 * (đầu số / kịch bản / giọng đọc, xem `catalogApi.ts`; curl gốc ở
 * `cloud-vihat-saas-omicrm-callbot-service/docs/related-api/*.txt`).
 *
 * Không còn nhánh nhập tay/localStorage: giá trị gõ tay sai (scriptUuid không tồn tại,
 * số không thuộc doanh nghiệp) chỉ đẩy lỗi xuống lúc submit/gọi, khó lần hơn nhiều.
 * API lỗi thì UI hiện lỗi theo từng danh mục + nút thử lại.
 *
 * Mock mode không gọi API — field tự dùng danh mục demo trong `components/session/catalogs.ts`.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SipNumber } from '@/contracts/types';
import {
  CatalogError, fetchScripts, fetchSipNumbers, fetchVoices,
  type ScriptOption, type VoiceOption,
} from './catalogApi';
import { IS_REAL } from './sessionApi';
import { getToken, TOKEN_CHANGED_EVENT } from './token';

export interface CatalogState {
  scripts: ScriptOption[];
  sipNumbers: SipNumber[];
  voices: VoiceOption[];
  loading: boolean;
  /** Lỗi theo từng danh mục — 3 API độc lập nên 1 cái chết không được che 2 cái kia. */
  errors: { scripts?: string; sipNumbers?: string; voices?: string };
  reload: () => void;
}

function messageOf(e: unknown): string {
  return e instanceof CatalogError || e instanceof Error ? e.message : String(e);
}

export function useCatalogs(): CatalogState {
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

  return { ...api, loading, errors, reload };
}
