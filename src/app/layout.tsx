import type { Metadata } from 'next';
import { TokenConfig } from '@/components/TokenConfig';
import './globals.css';

export const metadata: Metadata = {
  title: 'Callbot Client Session',
  description: 'Mô phỏng tích hợp luồng phiên callbot (mock BFF)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <header className="flex items-center justify-between bg-(--color-navy) px-6 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="text-lg font-extrabold tracking-wide">OMI<span className="text-(--color-primary)">CALL</span></span>
            <span className="text-sm text-white/70">· Client Session</span>
          </div>
          <div className="flex items-center gap-2">
            {/* NEXT_PUBLIC_CALLBOT_MODE là biến quyết định mode của cả app (IS_REAL trong
                lib/sessionApi.ts) — đừng gate bằng CALLBOT_MODE server-side, lệch nhau là
                mất nút Token trong khi app vẫn gọi thẳng BE. */}
            {process.env.NEXT_PUBLIC_CALLBOT_MODE === 'real' && <TokenConfig />}
            <span className="rounded-full bg-white/15 px-3 py-0.5 text-xs">
              {process.env.NEXT_PUBLIC_CALLBOT_MODE === 'real'
                ? `REAL · ${(() => { try { return new URL(process.env.NEXT_PUBLIC_CALLBOT_BASE_URL ?? '').host; } catch { return 'stg'; } })()}`
                : 'MOCK'}
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-350 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
