import type { Metadata } from "next";
import { iranYekan } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repair Master | مدیریت پلتفرم",
  description: "پنل مدیریت پلتفرم Repair Master SaaS",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className={`${iranYekan.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
