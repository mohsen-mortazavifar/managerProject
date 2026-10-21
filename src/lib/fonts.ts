// src/lib/fonts.ts
// import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";

export const iranYekan = localFont({
  src: [
    {
      path: "../assets/fonts/Iranyekan.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../assets/fonts/IranYekan-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-iran-yekan",
});



// const geistSans = Geist({
//   variable: "--font-geist-sans",
//   subsets: ["latin"],
// });

// const geistMono = Geist_Mono({
//   variable: "--font-geist-mono",
//   subsets: ["latin"],
// });