import "./globals.css";
export const metadata = {
  title: "星盘生成与本月运势",
  description: "输入生日日期和城市，生成出生日星盘与本月运势图片",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}