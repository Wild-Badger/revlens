import { AnalyticsStatus } from "@/components/analytics-status";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DashboardShell } from "./dashboard-shell";
import { SessionProvider } from "@/components/session-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RevLens - Revenue Intelligence",
  description: "SaaS Revenue Intelligence Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('revlens-theme')==='light')document.documentElement.dataset.theme='light'}catch{}" }} />
      </head>
      <body className="min-h-full bg-neutral-950 text-neutral-100 font-sans">
        <SessionProvider>
          <DashboardShell><AnalyticsStatus />{children}</DashboardShell>
        </SessionProvider>
      </body>
    </html>
  );
}
