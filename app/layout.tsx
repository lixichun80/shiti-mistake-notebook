import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "拾题 · 智能错题本",
  description: "拍照上传试卷和作业，整理每一道值得重做的题。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
