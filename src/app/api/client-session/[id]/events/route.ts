/**
 * SSE realtime cho MOCK mode — thay cho socket gateway thật.
 * Real mode: FE nối socket.io trực tiếp tới gateway (ticket C-03), route này không dùng.
 * Hook FE (useSessionRealtime) trừu tượng hoá nên khi flip mode FE không đổi code màn hình.
 */
import { getGateway } from '@/bff/gateway';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gateway = getGateway();
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      try {
        unsubscribe = gateway.subscribe(id, send);
        send({ event: 'connected', data: { clientSessionId: id } });
      } catch (e) {
        send({ event: 'error', data: { message: e instanceof Error ? e.message : String(e) } });
        controller.close();
      }
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
