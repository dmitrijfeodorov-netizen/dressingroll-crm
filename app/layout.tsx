import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DressingRoll CRM",
  description: "B2B clinic sales control for DressingRoll",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
