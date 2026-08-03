/**
 * MockGateway — implement CallbotGateway trên simulator in-memory.
 * Guard/validate BÁM SÁT backend thật (docs 05 §1.1 + state machine 01 §4)
 * để khi flip sang real mode, FE không gặp bất ngờ về lỗi nghiệp vụ.
 */
import type {
  AppendMode, ClientDataSource, ClientSession, ContactSuggestion, CreateSessionRequest,
  CrmContactFilter, DataRow, ImportBatch, ImportExcelResult, ManualRowsRequest, SessionReport,
  UpdateSessionRequest,
} from '@/contracts/types';
import type { SessionEvent } from '@/contracts/events';
import { GatewayError, type CallbotGateway, type SessionAction } from '../gateway';
import { db, emit, nextId, type MockSessionState } from './store';
import { computeCounters, emitLifecycle, emitStats, startTicking, stopTicking } from './simulator';

const TENANT_ID = 'tenant_demo';

/** Danh bạ mock cho autocomplete (img_2 template) — real mode sẽ query API contact CRM. */
const MOCK_CONTACTS: ContactSuggestion[] = [
  { id: 'cnt_1', name: 'TamTD', phones: ['0983223566', '0964913264'] },
  { id: 'cnt_2', name: 'Nguyen Van A', phones: ['0987654321'] },
  { id: 'cnt_3', name: 'Tran Thi B', phones: ['0912345678', '0908111222'] },
  { id: 'cnt_4', name: 'Le Van C', phones: ['0905000111'] },
  { id: 'cnt_5', name: 'Pham Thi D', phones: ['0977888999'] },
  { id: 'cnt_6', name: 'Hoang Van E', phones: ['0966555444'] },
  { id: 'cnt_7', name: 'Vu Thi F', phones: ['0933222111'] },
  { id: 'cnt_8', name: 'Dang Van G', phones: ['0922333444', '0899000111'] },
];

/** Nhóm config core chỉ sửa được ở DRAFT (docs 01 §5); nhóm tunable sửa được khi chưa terminal. */
const RUNTIME_TUNABLE_KEYS = new Set(['name', 'purpose', 'timeSlots', 'batchSize', 'batchIntervalSeconds', 'startTimeMs']);

function must(id: string): MockSessionState {
  const state = db().sessions.get(id);
  if (!state) throw new GatewayError('CS_NOT_FOUND', `Client session not found: ${id}`);
  return state;
}

function normalizePhone(phone: string): string | null {
  const digits = (phone || '').trim().replace(/^\+/, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** Mock chạy job đồng bộ nên batch sinh ra đã DONE — vẫn lưu lại để UI poll thấy lịch sử. */
function finishedBatch(
  id: string,
  type: ImportBatch['type'],
  source: ClientDataSource | undefined,
  totalRows: number,
  result: { inserted: number; duplicated: number; invalid: number },
): ImportBatch {
  const state = must(id);
  const batch: ImportBatch = {
    id: nextId('batch'),
    clientSessionId: id,
    type,
    source,
    status: 'DONE',
    totalRows,
    processedRows: totalRows,
    inserted: result.inserted,
    duplicated: result.duplicated,
    invalid: result.invalid,
    createdTimeMs: Date.now(),
    finishedTimeMs: Date.now(),
  };
  state.importBatches = [batch, ...(state.importBatches ?? [])].slice(0, 10);
  return batch;
}

export const mockGateway: CallbotGateway = {
  async createSession(req: CreateSessionRequest): Promise<ClientSession> {
    if (!req.name?.trim()) throw new GatewayError('CS_INVALID_CONFIG', 'name is required');
    if (!req.sipNumbers?.length) throw new GatewayError('CS_INVALID_CONFIG', 'sipNumbers must not be empty');
    const session: ClientSession = {
      id: nextId('cs'),
      tenantId: TENANT_ID,
      name: req.name.trim(),
      purpose: req.purpose,
      status: 'DRAFT',
      startTimeMs: req.startTimeMs ?? null,
      timeSlots: req.timeSlots,
      timezoneId: req.timezoneId ?? 'Asia/Ho_Chi_Minh',
      sipNumbers: req.sipNumbers,
      scriptUuid: req.scriptUuid ?? 'uuid-demo-script',
      voiceOverride: req.voiceOverride ?? null,
      retryConfig: req.retryConfig ?? null,
      batchSize: req.batchSize ?? 50,
      batchIntervalSeconds: req.batchIntervalSeconds ?? 30,
      variablePriority: req.variablePriority ?? 'SESSION_DATA_FIRST',
      dedupeConfig: req.dedupeConfig ?? { mode: 'PHONE' },
      runtimeSessionId: null,
      createdTimeMs: Date.now(),
    };
    const state: MockSessionState = { session, rows: [], timer: null, listeners: new Set(), seq: 0 };
    db().sessions.set(session.id, state);
    return session;
  },

  async listSessions(): Promise<ClientSession[]> {
    return [...db().sessions.values()]
      .map((s) => ({ ...s.session, counters: computeCounters(s) }))
      .sort((a, b) => b.createdTimeMs - a.createdTimeMs);
  },

  async getSession(id: string): Promise<ClientSession> {
    const state = must(id);
    return { ...state.session, counters: computeCounters(state) };
  },

  async updateSession(id: string, patch: UpdateSessionRequest): Promise<ClientSession> {
    const state = must(id);
    const s = state.session;
    if (s.status === 'COMPLETED' || s.status === 'CANCELED') {
      throw new GatewayError('CS_INVALID_STATE', 'Session is terminal — cannot update');
    }
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (s.status !== 'DRAFT') {
      const illegal = entries.map(([k]) => k).filter((k) => !RUNTIME_TUNABLE_KEYS.has(k));
      if (illegal.length > 0) {
        throw new GatewayError('CS_INVALID_STATE',
          `Chỉ sửa được ${[...RUNTIME_TUNABLE_KEYS].join('/')} khi phiên đã submit — vi phạm: ${illegal.join(', ')}`);
      }
    }
    Object.assign(s, Object.fromEntries(entries));
    // derive variablePriority từ variableOrder (gap docs 04 §5): CRM đứng trước MANUAL → CRM_CONTACT_FIRST
    if (patch.variableOrder) {
      const crmIdx = patch.variableOrder.indexOf('CRM');
      const manualIdx = patch.variableOrder.indexOf('MANUAL');
      s.variablePriority = crmIdx >= 0 && manualIdx >= 0 && crmIdx < manualIdx
        ? 'CRM_CONTACT_FIRST' : 'SESSION_DATA_FIRST';
    }
    return { ...s, counters: computeCounters(state) };
  },

  async doAction(id: string, action: SessionAction): Promise<ClientSession> {
    const state = must(id);
    const s = state.session;
    switch (action) {
      case 'submit': {
        if (s.status !== 'DRAFT') throw new GatewayError('CS_INVALID_STATE', `Only DRAFT can be submitted, current: ${s.status}`);
        if (s.batchSize < 1 || s.batchSize > 500) throw new GatewayError('CS_INVALID_CONFIG', 'batchSize must be in [1,500]');
        if (!state.rows.some((r) => r.rowStatus === 'STAGED')) throw new GatewayError('CS_NO_DATA', 'No STAGED data row to run');
        s.status = 'SCHEDULED';
        s.runtimeSessionId = `cs_${s.id}`;
        s.submittedTimeMs = Date.now();
        emitLifecycle(state, null);
        startTicking(state);
        break;
      }
      case 'pause': {
        if (s.status !== 'RUNNING') throw new GatewayError('CS_INVALID_STATE', `Only RUNNING can be paused, current: ${s.status}`);
        s.status = 'PAUSED';
        s.pausedCause = 'User pause';
        stopTicking(state);
        emitLifecycle(state, s.pausedCause);
        break;
      }
      case 'resume': {
        if (s.status !== 'PAUSED') throw new GatewayError('CS_INVALID_STATE', `Only PAUSED can be resumed, current: ${s.status}`);
        s.status = 'RUNNING';
        s.pausedCause = null;
        emitLifecycle(state, null);
        startTicking(state);
        break;
      }
      case 'cancel': {
        if (s.status === 'DRAFT' || s.status === 'COMPLETED' || s.status === 'CANCELED') {
          throw new GatewayError('CS_INVALID_STATE', `Cannot cancel from ${s.status}`);
        }
        s.status = 'CANCELED';
        s.cancelCause = 'Client cancel';
        stopTicking(state);
        for (const row of state.rows) {
          if (row.rowStatus === 'STAGED' || row.rowStatus === 'QUEUED' || row.rowStatus === 'DUPLICATE' || row.rowStatus === 'INVALID') {
            row.rowStatus = 'REMOVED';
          } else if (row.rowStatus === 'DISPATCHED') {
            if (!row.callResult) row.callResult = 'CANCELED';
            row.rowStatus = 'DONE';
          }
        }
        emitStats(state);
        emitLifecycle(state, s.cancelCause);
        break;
      }
    }
    return { ...s, counters: computeCounters(state) };
  },

  async addManualRows(id: string, req: ManualRowsRequest) {
    const state = must(id);
    const s = state.session;
    if (s.status === 'COMPLETED' || s.status === 'CANCELED') {
      throw new GatewayError('CS_INVALID_STATE', 'Session no longer accepts data');
    }
    const dedupeMode = s.dedupeConfig?.mode ?? 'PHONE';
    const fieldId = s.dedupeConfig?.fieldId;
    const seen = new Set(
      state.rows
        .filter((r) => r.rowStatus !== 'REMOVED' && r.rowStatus !== 'INVALID')
        .map((r) => dedupeKeyOf(dedupeMode, fieldId, r.phoneNumber, r.variables)),
    );
    // RUN_NOW: chen lên trước mọi dòng STAGED hiện có (docs 03 §3.3 — DECR min_priority)
    const minPriority = Math.min(0, ...state.rows.filter((r) => r.rowStatus === 'STAGED').map((r) => r.priority));
    const basePriority = req.appendMode === 'RUN_NOW' ? minPriority - 1_000_000 : Date.now();

    const created: DataRow[] = [];
    let inserted = 0, duplicated = 0, invalid = 0;
    for (const [i, raw] of req.rows.entries()) {
      const phone = normalizePhone(raw.phoneNumber);
      const row: DataRow = {
        rowId: nextId('row'),
        clientSessionId: id,
        phoneNumber: phone ?? raw.phoneNumber,
        variables: raw.variables,
        source: req.source ?? 'MANUAL',
        rowStatus: 'STAGED',
        priority: basePriority + i,
        createdTimeMs: Date.now(),
      };
      if (!phone) {
        row.rowStatus = 'INVALID';
        row.invalidReason = 'Số điện thoại không hợp lệ';
        invalid++;
      } else {
        const key = dedupeKeyOf(dedupeMode, fieldId, phone, raw.variables);
        if (key && seen.has(key)) {
          row.rowStatus = 'DUPLICATE';
          duplicated++;
        } else {
          if (key) seen.add(key);
          inserted++;
        }
      }
      state.rows.push(row);
      created.push(row);
    }
    emitStats(state);
    return { inserted, duplicated, invalid, rows: created };
  },

  async searchRows(id: string, statuses?: string[]): Promise<DataRow[]> {
    const state = must(id);
    const filter = statuses?.length ? new Set(statuses) : null;
    return state.rows
      .filter((r) => !filter || filter.has(r.rowStatus))
      .sort((a, b) => a.priority - b.priority || a.createdTimeMs - b.createdTimeMs);
  },

  async removeRows(id: string, rowIds: string[]): Promise<number> {
    const state = must(id);
    const ids = new Set(rowIds);
    let removed = 0;
    for (const row of state.rows) {
      if (ids.has(row.rowId)) {
        if (row.rowStatus === 'QUEUED' || row.rowStatus === 'DISPATCHED' || row.rowStatus === 'DONE') {
          throw new GatewayError('CS_ROW_NOT_EDITABLE', `Row đã vào pipeline gọi: ${row.rowId}`);
        }
        row.rowStatus = 'REMOVED';
        removed++;
      }
    }
    emitStats(state);
    return removed;
  },

  async searchContacts(query: string): Promise<ContactSuggestion[]> {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return MOCK_CONTACTS.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phones.some((p) => p.includes(q)),
    ).slice(0, 8);
  },

  async setAppendMode(): Promise<void> {
    // mock: appendMode truyền ngay trong addManualRows — API riêng để dành khi chốt UX với BE (09 §6.3)
  },

  // ===== Job nền + báo cáo: mock chạy ĐỒNG BỘ, kết quả có ngay (real thì chạy nền) =====

  async importExcel(): Promise<ImportExcelResult> {
    // Route handler /data/import-excel tự parse file rồi gọi addManualRows ở mock mode,
    // nên gateway không bao giờ được gọi đường này. Ném lỗi rõ thay vì trả số 0 gây hiểu nhầm.
    throw new GatewayError('CS_NOT_READY', 'Mock mode parse Excel tại BFF — không đi qua gateway.importExcel');
  },

  async previewCrm(_id: string, filter: CrmContactFilter): Promise<number> {
    // ước lượng giả lập: có filter thì ít hơn, không filter thì cả "danh bạ"
    const base = MOCK_CONTACTS.length * 120;
    const narrowing = [filter.tagIds, filter.categoryIds, filter.businessIds, filter.userOwnerIds]
      .filter((f) => f && f.length > 0).length;
    return Math.max(1, Math.round(base / Math.pow(3, narrowing)));
  },

  async importCrm(id: string, filter: CrmContactFilter, appendMode?: AppendMode): Promise<ImportBatch> {
    const count = await mockGateway.previewCrm(id, filter);
    const rows = Array.from({ length: Math.min(count, 50) }, (_, i) => ({
      phoneNumber: `09${String(30000000 + i).padStart(8, '0')}`,
      variables: { full_name: `Khách CRM ${i + 1}` },
    }));
    const result = await mockGateway.addManualRows(id, { rows, source: 'CRM', appendMode });
    return finishedBatch(id, 'IMPORT', 'CRM', rows.length, result);
  },

  async listImportBatches(id: string): Promise<ImportBatch[]> {
    return must(id).importBatches ?? [];
  },

  async recheckDedupe(id: string): Promise<ImportBatch> {
    const state = must(id);
    if (state.session.status !== 'DRAFT') {
      throw new GatewayError('CS_INVALID_STATE', 'Chỉ tính lại trùng khi phiên còn ở nháp');
    }
    // tính lại từ đầu: dòng đứng trước trong hàng đợi giữ key
    const seen = new Set<string>();
    let staged = 0, duplicated = 0;
    for (const row of [...state.rows].sort((a, b) => a.priority - b.priority)) {
      if (row.rowStatus === 'REMOVED' || row.rowStatus === 'INVALID') continue;
      if (row.rowStatus === 'QUEUED' || row.rowStatus === 'DISPATCHED' || row.rowStatus === 'DONE') continue;
      const key = dedupeKeyOf(state.session.dedupeConfig?.mode ?? 'PHONE', state.session.dedupeConfig?.fieldId, row.phoneNumber, row.variables);
      if (key && seen.has(key)) {
        row.rowStatus = 'DUPLICATE';
        duplicated++;
      } else {
        if (key) seen.add(key);
        row.rowStatus = 'STAGED';
        staged++;
      }
    }
    emitStats(state);
    return finishedBatch(id, 'RECHECK', undefined, staged + duplicated,
      { inserted: staged, duplicated, invalid: 0 });
  },

  async updateRow(id: string, rowId: string, patch): Promise<DataRow> {
    const state = must(id);
    const row = state.rows.find((r) => r.rowId === rowId);
    if (!row) throw new GatewayError('CS_NOT_FOUND', `Không thấy dòng ${rowId}`);
    if (row.rowStatus === 'QUEUED' || row.rowStatus === 'DISPATCHED' || row.rowStatus === 'DONE') {
      throw new GatewayError('CS_ROW_NOT_EDITABLE', 'Dòng đã vào hàng đợi gọi — không sửa được');
    }
    if (patch.phoneNumber !== undefined) row.phoneNumber = patch.phoneNumber.replace(/\D/g, '');
    if (patch.variables !== undefined) row.variables = patch.variables;
    const key = dedupeKeyOf(state.session.dedupeConfig?.mode ?? 'PHONE', state.session.dedupeConfig?.fieldId, row.phoneNumber, row.variables);
    const clash = key
      ? state.rows.some((r) => r.rowId !== rowId && r.rowStatus === 'STAGED'
        && dedupeKeyOf(state.session.dedupeConfig?.mode ?? 'PHONE', state.session.dedupeConfig?.fieldId, r.phoneNumber, r.variables) === key)
      : false;
    row.rowStatus = !/^\d{8,15}$/.test(row.phoneNumber) ? 'INVALID' : clash ? 'DUPLICATE' : 'STAGED';
    row.invalidReason = row.rowStatus === 'INVALID' ? 'Số điện thoại không hợp lệ' : null;
    emitStats(state);
    return row;
  },

  async restoreDuplicate(id: string, rowId: string): Promise<DataRow> {
    const state = must(id);
    const row = state.rows.find((r) => r.rowId === rowId);
    if (!row) throw new GatewayError('CS_NOT_FOUND', `Không thấy dòng ${rowId}`);
    if (row.rowStatus !== 'DUPLICATE') {
      throw new GatewayError('CS_INVALID_STATE', 'Chỉ khôi phục được dòng đang ở trạng thái Trùng');
    }
    row.rowStatus = 'STAGED';
    emitStats(state);
    return row;
  },

  async report(id: string): Promise<SessionReport> {
    const state = must(id);
    const byRowStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byCallResult: Record<string, number> = {};
    for (const row of state.rows) {
      byRowStatus[row.rowStatus] = (byRowStatus[row.rowStatus] ?? 0) + 1;
      if (row.rowStatus !== 'REMOVED') bySource[row.source] = (bySource[row.source] ?? 0) + 1;
      if (row.callResult) byCallResult[row.callResult] = (byCallResult[row.callResult] ?? 0) + 1;
    }
    const finished = Object.values(byCallResult).reduce((a, b) => a + b, 0);
    const answered = byCallResult.ANSWERED ?? 0;
    return {
      sessionId: id,
      name: state.session.name,
      status: state.session.status,
      byRowStatus, bySource, byCallResult,
      totalRows: state.rows.length,
      finishedCalls: finished,
      answerRate: finished === 0 ? 0 : Math.round((answered * 10000) / finished) / 100,
      counters: state.session.counters,
    };
  },

  async exportData(id: string, rowStatuses?: string[]): Promise<ImportBatch> {
    const state = must(id);
    const filter = rowStatuses?.length ? new Set(rowStatuses) : null;
    const count = state.rows.filter((r) => !filter || filter.has(r.rowStatus)).length;
    const batch = finishedBatch(id, 'EXPORT', undefined, count, { inserted: 0, duplicated: 0, invalid: 0 });
    batch.fileName = `${state.session.name}.xlsx`;
    batch.fileKey = `mock/export/${id}.xlsx`;
    return batch;
  },

  subscribe(id: string, listener: (e: SessionEvent) => void): () => void {
    const state = must(id);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
};

function dedupeKeyOf(
  mode: string, fieldId: string | null | undefined, phone: string, variables?: Record<string, string>,
): string | null {
  if (mode === 'NONE') return null;
  if (mode === 'FIELD') {
    const v = fieldId ? variables?.[fieldId] : undefined;
    return v ? v.trim().toLowerCase() : null;
  }
  return phone;
}
