import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Đại Chiến Thủy Cung — TikTok Live Fishing Game",
  description: "Hệ thống game câu cá tương tác TikTok Live và AI Caster thời gian thực",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className="h-full antialiased" suppressHydrationWarning>
      <body
        className="min-h-full flex flex-col bg-slate-950 text-slate-100 font-sans"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
