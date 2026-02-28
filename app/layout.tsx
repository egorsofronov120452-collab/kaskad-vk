import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });

export const metadata = {
  title: 'Kaskad — Панель управления',
  description: 'Панель управления VK-ботами: доставка, такси, сотрудники',
};

export const viewport = {
  themeColor: '#0a0a0b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={inter.className}>
      <body>{children}</body>
    </html>
  );
}
