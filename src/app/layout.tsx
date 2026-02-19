import type { Metadata, Viewport } from "next";
import { Outfit, Inter } from "next/font/google";
import "./globals.css";

const fontOutfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const fontInter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Scheduler | Sync with Friends",
  description: "The premium way to schedule weekly meetings and hangouts with your friends.",
  keywords: ["scheduler", "meetings", "friends", "availability", "weekly"],
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontOutfit.variable} ${fontInter.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
