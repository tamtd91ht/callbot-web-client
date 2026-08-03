/** Danh mục mock cho màn Lên phiên — real mode sẽ lấy từ API (đầu số, kịch bản, giọng đọc). */
import type { SipNumber } from '@/contracts/types';

export const PURPOSES = ['Auto Call', 'Nhắc phí', 'CSKH', 'Khảo sát', 'Telesale'];

export const SIP_NUMBERS: SipNumber[] = [
  { number: '799333333', network: 'viettel', gateway: 'gw1' },
  { number: '842873001111', network: 'viettel', gateway: 'gw1' },
  { number: '842873002222', network: 'mobifone', gateway: 'gw2' },
];

export const SCRIPTS = [
  { uuid: 'uuid-demo-script', name: 'CallBot - Phân loại' },
  { uuid: 'uuid-demo-nhacphi', name: 'CallBot - Nhắc phí' },
  { uuid: 'uuid-demo-khaosat', name: 'CallBot - Khảo sát CSAT' },
];

/** Mirror enum Voice của BE (docs 01) — value gửi xuống = tên enum. */
export const VOICES = [
  { value: '', label: 'Theo kịch bản (không override)' },
  { value: 'northern_female_ngocanh', label: 'Ngọc Anh — Tiếng Việt, Nữ, miền Bắc' },
  { value: 'southern_female_honganh', label: 'Hồng Anh — Tiếng Việt, Nữ, miền Nam' },
  { value: 'southern_male_tienhuy', label: 'Tiến Huy — Tiếng Việt, Nam, miền Nam' },
  { value: 'northern_male_anhkiet', label: 'Anh Kiệt — Tiếng Việt, Nam, miền Bắc' },
];

/** 3 nguồn của chips "Thứ tự ưu tiên giá trị biến" (map template img_3). */
export const VARIABLE_SOURCES = [
  { key: 'EXCEL', label: 'File excel' },
  { key: 'CRM', label: 'Thuộc tính khách hàng' },
  { key: 'MANUAL', label: 'Giá trị nhập' },
];

export const CUSTOMER_QUOTA = 2000;

export const COUNTRY_CODE_OPTIONS = ['Không áp dụng', '+84', '84', '0084', 'Tùy chỉnh'] as const;
export type CountryCodeOption = (typeof COUNTRY_CODE_OPTIONS)[number];

/** Chuẩn hoá SĐT theo chip mã quốc gia (drawer Thủ công — img_1). */
export function applyCountryCode(phone: string, option: CountryCodeOption, custom: string): string {
  const digits = phone.trim();
  if (option === 'Không áp dụng' || !digits) return digits;
  const bare = digits.replace(/^\+?84/, '').replace(/^0084/, '').replace(/^0/, '');
  switch (option) {
    case '+84': return `+84${bare}`;
    case '84': return `84${bare}`;
    case '0084': return `0084${bare}`;
    case 'Tùy chỉnh': return `${custom.trim()}${bare}`;
  }
}
