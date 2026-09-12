import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "研面官 · 预推免物语",
  description: "用 galgame 的方式攻略面试官，用追问树的方式复盘每一次翻车。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
