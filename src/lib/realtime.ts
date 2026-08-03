'use client';
/**
 * useSessionRealtime — trừu tượng hoá kênh realtime để MÀN HÌNH không đổi code khi flip mode:
 *   - mock (hiện tại): SSE từ BFF /api/client-session/[id]/events
 *   - real (C-03):     socket.io tới gateway (namespace /call_bot, room tenantId) — thay ruột hook này
 * Nguyên tắc (docs 09): mọi số liệu trong event là SỐ TUYỆT ĐỐI — không cộng dồn phía FE.
 */
import { useEffect, useRef, useState } from 'react';
import type { SessionEvent } from '@/contracts/events';

export function useSessionRealtime(
  clientSessionId: string | null,
  onEvent: (event: SessionEvent) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!clientSessionId) return;
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
  }, [clientSessionId]);

  return { connected };
}
