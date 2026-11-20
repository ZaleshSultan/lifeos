import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LifeOS",
  description: "Учёба, дела и личный план в LifeOS.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0c0c0e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
