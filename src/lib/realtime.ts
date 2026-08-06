'use client';
/**
 * useSessionRealtime — trừu tượng hoá kênh realtime để MÀN HÌNH không đổi code khi flip mode:
 *   - mock: SSE từ BFF /api/client-session/[id]/events (simulator in-memory)
 *   - real: socket.io tới socket gateway của OMICRM, namespace /call_bot
 *
 * Nguyên tắc (docs 09): mọi số liệu trong event là SỐ TUYỆT ĐỐI — KHÔNG cộng dồn phía FE.
 *
 * Cách nối real mode bám đúng app OMICRM đang chạy thật (web-v2 constants/Configs.js socketConfig
 * + MarketingAutoCallDetailV2.initSocket): base URL socket-event + tên namespace, transports
 * websocket, token/env truyền qua query của handshake.
 *
 * LƯU Ý QUAN TRỌNG về room: callbot-service publish event vào room = **tenantId**, KHÔNG phải
 * sessionId (ClientSessionSocketService). Nghĩa là client nhận được event của MỌI phiên trong
 * doanh nghiệp → buộc phải tự lọc theo clientSessionId, nếu không số liệu phiên này sẽ bị
 * ghi đè bởi phiên khác đang chạy song song.
 */
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { SessionEvent } from '@/contracts/events';
import { IS_REAL } from './sessionApi';
import { getToken, tokenTenantId } from './token';

/** Base URL socket gateway — khớp socketConfig.event của web-v2 (stg). */
const SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL
  || 'https://socket-event-v1-stg.omicrm.com').replace(/\/$/, '');

const NAMESPACE = 'call_bot';

/** Chỉ 2 event này ảnh hưởng tới màn chi tiết phiên; các event khác (import/export) do panel riêng poll. */
const HANDLED_EVENTS = ['clientSessionStats', 'clientSessionLifecycle'] as const;

export function useSessionRealtime(
  clientSessionId: string | null,
  onEvent: (event: SessionEvent) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!clientSessionId) return;
    return IS_REAL
      ? connectSocket(clientSessionId, handlerRef, setConnected)
      : connectSse(clientSessionId, handlerRef, setConnected);
  }, [clientSessionId]);

  return { connected };
}

/* ============================== real: socket.io ============================== */

function connectSocket(
  clientSessionId: string,
  handlerRef: React.MutableRefObject<(event: SessionEvent) => void>,
  setConnected: (value: boolean) => void,
): () => void {
  const token = getToken();
  if (!token) {
    setConnected(false);
    return () => {};
  }

  let socket: Socket | null = null;
  let disposed = false;

  // import động: socket.io-client chỉ cần ở real mode, không kéo vào bundle mock
  void import('socket.io-client').then(({ io }) => {
    if (disposed) return;
    socket = io(`${SOCKET_URL}/${NAMESPACE}`, {
      transports: ['websocket'],
      query: {
        token: token.replace(/^Bearer\s+/i, ''),
        env: 'web',
        // gateway route event theo tenant; gửi kèm để phòng trường hợp gateway cần join room tường minh
        tenantId: tokenTenantId(token) ?? '',
      },
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    for (const eventName of HANDLED_EVENTS) {
      socket.on(eventName, (payload: unknown) => {
        const data = unwrapSocketPayload(payload);
        // Room là tenantId → phải tự lọc, nếu không phiên khác sẽ ghi đè số liệu phiên đang xem
        if (!data || data.clientSessionId !== clientSessionId) return;
        handlerRef.current({ event: eventName, data } as SessionEvent);
      });
    }
  }).catch(() => {
    if (!disposed) setConnected(false);
  });

  return () => {
    disposed = true;
    socket?.removeAllListeners();
    socket?.disconnect();
    setConnected(false);
  };
}

/**
 * Gateway có thể đẩy payload trần hoặc bọc trong SocketEvent {namespace, room, event, data}.
 * Nhận cả 2 dạng vì shape thật chưa được xác nhận bằng tài liệu.
 */
function unwrapSocketPayload(payload: unknown): { clientSessionId?: string } & Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const inner = obj.data;
  if (inner && typeof inner === 'object' && 'clientSessionId' in (inner as object)) {
    return inner as { clientSessionId?: string } & Record<string, unknown>;
  }
  if ('clientSessionId' in obj) return obj as { clientSessionId?: string } & Record<string, unknown>;
  return null;
}

/* ============================== mock: SSE ============================== */

function connectSse(
  clientSessionId: string,
  handlerRef: React.MutableRefObject<(event: SessionEvent) => void>,
  setConnected: (value: boolean) => void,
): () => void {
  const source = new EventSource(`/api/client-session/${clientSessionId}/events`);
  source.onopen = () => setConnected(true);
  source.onerror = () => setConnected(false);
  source.onmessage = (message) => {
    try {
      const parsed = JSON.parse(message.data) as SessionEvent | { event: 'connected' | 'error' };
      if (parsed.event === 'clientSessionStats' || parsed.event === 'clientSessionLifecycle') {
        handlerRef.current(parsed as SessionEvent);
      }
    } catch {
      /* bỏ qua message hỏng */
    }
  };
  return () => {
    source.close();
    setConnected(false);
  };
}
