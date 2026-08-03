/**
 * CallbotGateway — cổng duy nhất BFF nói chuyện với "backend" (mirror docs 05).
 * 2 implementation:
 *   - MockGateway  : simulator in-memory, mô phỏng ĐÚNG state machine docs 01 §4 + dispatcher docs 03
 *   - RealGateway  : proxy REST sang callbot-service (bật khi BE B8 xong — CALLBOT_MODE=real)
 * FE/route handlers KHÔNG được import mock/real trực tiếp — chỉ qua getGateway().
 */
import type {
  AppendMode, ClientSession, ContactSuggestion, CreateSessionRequest, DataRow,
  ManualRowsRequest, UpdateSessionRequest,
} from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';

export class GatewayError extends Error {
  constructor(public readonly errorCode: string, message: string) {
    super(message);
  }
}

export type SessionAction = 'submit' | 'pause' | 'resume' | 'cancel';

export interface CallbotGateway {
  createSession(req: CreateSessionRequest): Promise<ClientSession>;
  listSessions(): Promise<ClientSession[]>;
  getSession(id: string): Promise<ClientSession>;
  /** PATCH config — nhóm core chỉ khi DRAFT (docs 01 §5). */
  updateSession(id: string, patch: UpdateSessionRequest): Promise<ClientSession>;
  doAction(id: string, action: SessionAction): Promise<ClientSession>;
  addManualRows(id: string, req: ManualRowsRequest): Promise<{ inserted: number; duplicated: number; invalid: number; rows: DataRow[] }>;
  searchRows(id: string, statuses?: string[]): Promise<DataRow[]>;
  /** Xoá rows (chỉ STAGED/DUPLICATE/INVALID → REMOVED). */
  removeRows(id: string, rowIds: string[]): Promise<number>;
  /** Autocomplete contact CRM cho drawer Thủ công (mock; real qua API contact). */
  searchContacts(query: string): Promise<ContactSuggestion[]>;
  setAppendMode(id: string, mode: AppendMode): Promise<void>;
  /** Đăng ký nhận realtime events của 1 phiên (mock: từ simulator; real: C-03 sẽ chuyển FE nối socket trực tiếp). */
  subscribe(id: string, listener: (e: SessionEvent) => void): () => void;
}

import { mockGateway } from './mock/mockGateway';
import { realGateway } from './real/realGateway';

export function getGateway(): CallbotGateway {
  return process.env.CALLBOT_MODE === 'real' ? realGateway : mockGateway;
}
