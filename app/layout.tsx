import type { Metadata } from "next";
import { LayoutChrome } from "@/components/LayoutChrome";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SnapHub Global",
    template: "%s · SnapHub Global",
  },
  description:
    "SnapHub Global — gaming supply, AI system configuration, and server infrastructure for B2B partners. Inquiry-based.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black antialiased">
        <LayoutChrome>{children}</LayoutChrome>
      </body>
    </html>
  );
}
