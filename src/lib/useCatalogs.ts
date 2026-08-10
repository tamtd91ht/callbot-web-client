'use client';
/**
 * Danh mục cho màn Lên phiên — real mode lấy từ các gateway OmiCRM, đúng những API mà app
 * OMICRM thật (web-v2) dùng cho luồng tạo phiên AutoCall:
 *
 *   đầu số        GET  {pbx}/public_number_of_tenant/list_active      (lọc allow_call_out)
 *   kịch bản      GET  {chatbot}/callbot/script/list-by-tenant/{tenantId}
 *   giọng đọc     POST {chatbot}/bot-accent/list-all
 *   mục đích gọi  POST {cdr}/call_transaction/purpose/get_list        ← danh mục tenant tự định nghĩa
 *   thẻ           POST {tenantConfig}/tag/search-all                 ← lọc KH theo thuộc tính
 *   nhóm KH       POST {tenantConfig}/contact-categories/search-all
 *   loại hình     POST {tenantConfig}/business/search-all
 *   prefix mã QG  GET  {tenant}/phone_prefix/get_all
 *
 * Không có nhánh nhập tay: giá trị gõ tay sai (scriptUuid không tồn tại, số không thuộc doanh
 * nghiệp, id thẻ bịa) chỉ đẩy lỗi xuống lúc submit/gọi, khó lần hơn nhiều. API lỗi thì UI hiện
 * lỗi THEO TỪNG danh mục + nút thử lại — một API chết không được che các API còn lại.
 *
 * Mock mode không gọi API — field tự dùng danh mục demo trong `components/session/catalogs.ts`.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SipNumber } from '@/contracts/types';
import {
  CatalogError, fetchCallPurposes, fetchClassify, fetchPhonePrefixes, fetchScripts,
  fetchSipNumbers, fetchVoices,
  type CallPurposeOption, type ClassifyOption, type ScriptOption, type VoiceOption,
  fetchContactStatuses, type ContactStatusOption,
} from './catalogApi';
import { IS_REAL } from './sessionApi';
import { getToken, TOKEN_CHANGED_EVENT } from './token';

export type CatalogKey =
  | 'scripts' | 'sipNumbers' | 'voices' | 'callPurposes'
  | 'tags' | 'categories' | 'businesses' | 'phonePrefixes' | 'contactStatuses';

export interface CatalogState {
  scripts: ScriptOption[];
  sipNumbers: SipNumber[];
  voices: VoiceOption[];
  callPurposes: CallPurposeOption[];
  tags: ClassifyOption[];
  categories: ClassifyOption[];
  businesses: ClassifyOption[];
  phonePrefixes: string[];
  contactStatuses: ContactStatusOption[];
  loading: boolean;
  /** Lỗi theo từng danh mục — các API độc lập nên 1 cái chết không được che những cái kia. */
  errors: Partial<Record<CatalogKey, string>>;
  reload: () => void;
}

/** Nhãn tiếng Việt để ghép câu lỗi. */
const CATALOG_LABELS: Record<CatalogKey, string> = {
  contactStatuses: 'Trạng thái khách hàng',
  scripts: 'Kịch bản',
  sipNumbers: 'Đầu số',
  voices: 'Giọng đọc',
  callPurposes: 'Mục đích cuộc gọi',
  tags: 'Thẻ',
  categories: 'Nhóm khách hàng',
  businesses: 'Loại hình',
  phonePrefixes: 'Mã quốc gia',
};

type CatalogData = Omit<CatalogState, 'loading' | 'errors' | 'reload'>;

const EMPTY: CatalogData = {
  scripts: [], sipNumbers: [], voices: [], callPurposes: [],
  tags: [], categories: [], businesses: [], phonePrefixes: [], contactStatuses: [],
};

function messageOf(e: unknown): string {
  return e instanceof CatalogError || e instanceof Error ? e.message : String(e);
}

export function useCatalogs(): CatalogState {
  const [data, setData] = useState<CatalogData>(EMPTY);
  const [errors, setErrors] = useState<CatalogState['errors']>({});
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!IS_REAL || !getToken()) return; // mock mode / chưa dán token thì không gọi API
    let alive = true;
    setLoading(true);

    void (async () => {
      // allSettled: danh mục nào lỗi thì chỉ danh mục đó báo lỗi, phần còn lại vẫn dùng được
      const [scripts, sipNumbers, voices, callPurposes, tags, categories, businesses, phonePrefixes,
        contactStatuses] =
        await Promise.allSettled([
          fetchScripts(), fetchSipNumbers(), fetchVoices(), fetchCallPurposes(),
          fetchClassify('tag'), fetchClassify('category'), fetchClassify('business'),
          fetchPhonePrefixes(), fetchContactStatuses(),
        ]);
      if (!alive) return;

      const nextErrors: CatalogState['errors'] = {};

      /** Lấy items nếu thành công; ghi lỗi (hoặc cảnh báo không bóc được field) vào nextErrors. */
      const take = <T>(key: CatalogKey, result: PromiseSettledResult<{ items: T[]; unparsed?: string }>): T[] => {
        if (result.status === 'rejected') {
          nextErrors[key] = messageOf(result.reason);
          return [];
        }
        if (result.value.unparsed) {
          nextErrors[key] = `${CATALOG_LABELS[key]}: gọi được API nhưng không đọc được field. `
            + `Mẫu response: ${result.value.unparsed}`;
        }
        return result.value.items;
      };

      setData({
        scripts: take('scripts', scripts),
        sipNumbers: take('sipNumbers', sipNumbers),
        voices: take('voices', voices),
        callPurposes: take('callPurposes', callPurposes),
        tags: take('tags', tags),
        categories: take('categories', categories),
        businesses: take('businesses', businesses),
        phonePrefixes: take('phonePrefixes', phonePrefixes),
        contactStatuses: take('contactStatuses', contactStatuses),
      });
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

  return { ...data, loading, errors, reload };
}
