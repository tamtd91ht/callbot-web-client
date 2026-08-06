/**
 * Tính "phiên có đang trong khung giờ cho phép gọi?" — tương đương isOutsideAllSlots của AutoCall
 * (web-v2 dùng để hiện banner "pausedByOutTimeFrame" trên màn chi tiết phiên).
 *
 * BE chỉ lưu timeSlots + timezoneId và tự chặn ở dispatcher; không có endpoint nào trả về
 * "đang trong giờ hay không". Nên FE tự tính để giải thích cho người dùng vì sao phiên
 * đang RUNNING mà không có cuộc nào nổ ra — nếu không thì trông như hệ thống bị treo.
 *
 * QUY ƯỚC BE cần nhớ: daysOfWeek rỗng/không gửi = MỌI NGÀY (không phải "không ngày nào").
 */
import type { TimeSlot } from '@/contracts/types';

const MINUTES_PER_DAY = 24 * 60;

/** "HH:mm" → số phút từ 00:00. Trả null nếu sai định dạng. */
export function parseHhMm(value: string | undefined): number | null {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatHhMm(totalMinutes: number): string {
  const normalized = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Thời điểm hiện tại theo timezone của phiên (mặc định Asia/Ho_Chi_Minh — trùng default BE).
 * Dùng Intl thay vì offset cứng để không sai khi máy người dùng ở timezone khác.
 */
export function nowInZone(timezoneId?: string, at: Date = new Date()): { isoWeekday: number; minutes: number } {
  const zone = timezoneId || 'Asia/Ho_Chi_Minh';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).formatToParts(at);
  } catch {
    // timezoneId lạ → rơi về giờ máy, vẫn tốt hơn là ném lỗi giữa màn hình
    return { isoWeekday: isoWeekdayOf(at.getDay()), minutes: at.getHours() * 60 + at.getMinutes() };
  }
  const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  // hour12:false vẫn có thể trả "24" ở mốc nửa đêm trên một số runtime
  const hour = Number(lookup('hour')) % 24;
  return {
    isoWeekday: weekdayMap[lookup('weekday')] ?? isoWeekdayOf(at.getDay()),
    minutes: hour * 60 + Number(lookup('minute')),
  };
}

/** Date.getDay() (0=CN) → ISO (1=T2 … 7=CN). */
function isoWeekdayOf(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

function appliesOn(slot: TimeSlot, isoWeekday: number): boolean {
  // rỗng = mọi ngày (quy ước BE)
  if (!slot.daysOfWeek || slot.daysOfWeek.length === 0) return true;
  return slot.daysOfWeek.includes(isoWeekday);
}

export interface TimeSlotWindowState {
  /** true khi phiên được phép gọi ở thời điểm đang xét. */
  allowedNow: boolean;
  /** Khung giờ đang chứa thời điểm hiện tại (nếu có). */
  activeSlot: TimeSlot | null;
  /** Mốc bật lại gần nhất dạng "HH:mm" — chỉ có khi allowedNow = false. */
  nextOpenAt: string | null;
  /** Kèm nhãn ngày khi mốc bật lại không phải hôm nay, ví dụ "T2 08:00". */
  nextOpenLabel: string | null;
}

const DAY_LABELS: Record<number, string> = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };

/**
 * Trạng thái khung giờ tại thời điểm `at`. Không có slot nào hợp lệ = cả ngày = luôn được gọi
 * (đúng hành vi BE: timeSlots rỗng thì dispatcher chạy 24/7).
 */
export function evaluateTimeSlots(
  timeSlots: TimeSlot[] | undefined,
  timezoneId?: string,
  at: Date = new Date(),
): TimeSlotWindowState {
  const slots = (timeSlots ?? []).filter((slot) => parseHhMm(slot.from) !== null && parseHhMm(slot.to) !== null);
  if (slots.length === 0) {
    return { allowedNow: true, activeSlot: null, nextOpenAt: null, nextOpenLabel: null };
  }

  const { isoWeekday, minutes } = nowInZone(timezoneId, at);

  for (const slot of slots) {
    if (!appliesOn(slot, isoWeekday)) continue;
    const from = parseHhMm(slot.from)!;
    const to = parseHhMm(slot.to)!;
    if (minutes >= from && minutes < to) {
      return { allowedNow: true, activeSlot: slot, nextOpenAt: null, nextOpenLabel: null };
    }
  }

  // Ngoài giờ → tìm mốc mở gần nhất, quét tối đa 7 ngày tới
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const weekday = ((isoWeekday - 1 + dayOffset) % 7) + 1;
    const candidates = slots
      .filter((slot) => appliesOn(slot, weekday))
      .map((slot) => parseHhMm(slot.from)!)
      // hôm nay chỉ tính mốc còn ở phía trước
      .filter((from) => dayOffset > 0 || from > minutes)
      .sort((a, b) => a - b);
    if (candidates.length === 0) continue;
    const nextOpenAt = formatHhMm(candidates[0]);
    return {
      allowedNow: false,
      activeSlot: null,
      nextOpenAt,
      nextOpenLabel: dayOffset === 0 ? nextOpenAt : `${DAY_LABELS[weekday]} ${nextOpenAt}`,
    };
  }

  return { allowedNow: false, activeSlot: null, nextOpenAt: null, nextOpenLabel: null };
}
