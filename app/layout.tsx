import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/app/components/Sidebar";
import AcuitySyncNotifier from "@/app/components/AcuitySyncNotifier";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tonehouse Studio Ops",
  description: "Tonehouse Studio Ops",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        <div className="flex min-h-full">
          <Sidebar />
          <AcuitySyncNotifier />
          <main className="min-w-0 flex-1 pt-14 lg:pt-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
