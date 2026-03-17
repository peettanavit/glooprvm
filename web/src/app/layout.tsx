import type { Metadata } from "next";
import { Sarabun } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sarabun",
});

export const metadata: Metadata = {
  title: "Gloop RVM",
  description: "เครื่องรับคืนขวดอัจฉริยะ",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={sarabun.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
