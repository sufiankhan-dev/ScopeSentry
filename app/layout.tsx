import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ScopeSentry — local scope review for freelancers",
  description:
    "Compare a client conversation against the agreement you signed, with source evidence for every finding. Local-first, no cloud AI.",
};

export const viewport: Viewport = {
  themeColor: "#0e1320",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The app has one theme (see app/globals.css), so the browser is told
      // once here instead of guessing from the OS and repainting form controls.
      style={{ colorScheme: "dark" }}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}