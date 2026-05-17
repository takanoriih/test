import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '半期粗利計算ツール',
  description: '半期ごとの粗利・残業・達成度を管理するツール',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-800 antialiased">{children}</body>
    </html>
  );
}
