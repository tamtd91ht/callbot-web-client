import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Callbot Client Session',
  description: 'Mô phỏng tích hợp luồng phiên callbot (mock BFF)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <header className="topbar">
          <strong>Callbot · Client Session</strong>
          <span className="mode-badge">mode: {process.env.CALLBOT_MODE === 'real' ? 'REAL' : 'MOCK'}</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
