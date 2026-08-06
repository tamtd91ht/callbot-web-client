/**
 * Danh mục cho màn Lên phiên.
 *
 * `SCRIPTS` và `SIP_NUMBERS` là **MOCK**, chỉ dùng ở mock mode. Real mode lấy danh mục thật
 * từ 3 gateway OmiCRM (xem `lib/catalogApi.ts`) — không có đường nhập tay.
 *
 * `VOICES` thì KHÔNG mock: đây là toàn bộ enum `Voice` thật của BE, copy từ
 * `vihat/domain/vo/Voice.java`. Gửi value không khớp enum thì Jackson fail parse và BE bỏ qua
 * TOÀN BỘ config phức (mất luôn sipNumbers) — nên đừng tự sửa tay các value dưới đây.
 */
import type { SipNumber } from '@/contracts/types';
import type { ScriptOption } from '@/lib/catalogApi';

export const PURPOSES = ['Auto Call', 'Nhắc phí', 'CSKH', 'Khảo sát', 'Telesale'];

export const SIP_NUMBERS: SipNumber[] = [
  { number: '799333333', network: 'viettel', gateway: 'gw1' },
  { number: '842873001111', network: 'viettel', gateway: 'gw1' },
  { number: '842873002222', network: 'mobifone', gateway: 'gw2' },
];

/** Kèm `variables` để mock mode cũng chạy được khối "Biến cần nạp" ở ScriptField. */
export const SCRIPTS: ScriptOption[] = [
  {
    uuid: 'uuid-demo-script',
    name: 'CallBot - Phân loại',
    variables: [{ fieldCode: 'full_name', fieldName: 'Họ tên' }],
  },
  {
    uuid: 'uuid-demo-nhacphi',
    name: 'CallBot - Nhắc phí',
    variables: [
      { fieldCode: 'full_name', fieldName: 'Họ tên' },
      { fieldCode: 'so_tien', fieldName: 'Số tiền cần thu' },
      { fieldCode: 'han_thanh_toan', fieldName: 'Hạn thanh toán' },
    ],
  },
  { uuid: 'uuid-demo-khaosat', name: 'CallBot - Khảo sát CSAT' },
];

/** Toàn bộ enum Voice của BE (vihat/domain/vo/Voice.java) — value gửi xuống = tên enum. */
export const VOICES = [
  { value: '', label: 'Theo kịch bản (không override)' },
  { value: 'northern_female_ngocanh', label: 'Ngọc Anh — Nữ, miền Bắc' },
  { value: 'northern_male_anhkiet', label: 'Anh Kiệt — Nam, miền Bắc' },
  { value: 'southern_female_honganh', label: 'Hồng Anh — Nữ, miền Nam' },
  { value: 'southern_female_khangan', label: 'Khả Ngân — Nữ, miền Nam' },
  { value: 'southern_male_tienhuy', label: 'Tiến Huy — Nam, miền Nam' },
  { value: 'central_female_ngoclam', label: 'Ngọc Lam — Nữ, miền Trung' },
  { value: 'central_male_ngocqui', label: 'Ngọc Quí — Nam, miền Trung' },
  { value: 'yangon_female_zinthu', label: 'Zin Thu — Tiếng Miến (Yangon), Nữ' },
  { value: 'haitian_female', label: 'Haitian — Nữ' },
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
