export const metadata = {
  title: 'Kaskad VK Bot',
  description: 'VK Callback Bot API',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
