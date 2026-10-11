"use client";

import { useState } from "react";
import Link from "next/link";

type MobileDashboardProps = {
  farmUrl: string;
};

export function MobileDashboard({ farmUrl }: MobileDashboardProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/mobile/logout", { method: "POST" });
      window.location.href = "/mobile/login";
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Admin Header */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-white/40 transition hover:text-white/70">
              ← snaphubglobal.com
            </Link>
            <span className="text-white/20">|</span>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-b from-blue-500 to-blue-700">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2z" stroke="white" strokeWidth="1.5" />
                  <path d="M11 18h2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-white">Mobile Device Farm</span>
              <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                Admin
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <a
              href={farmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-white/50 transition hover:text-white"
            >
              Open in new tab ↗
            </a>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-full border border-white/10 px-4 py-1.5 text-xs font-medium text-white/70 transition hover:border-white/20 hover:text-white disabled:opacity-50"
            >
              {loggingOut ? "Signing out..." : "Sign Out"}
            </button>
          </div>
        </div>
      </header>

      {/* Iframe Container */}
      <div className="pt-14">
        <div className="relative h-[calc(100vh-3.5rem)] w-full">
          {!iframeLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="text-center">
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-blue-500" />
                <p className="text-sm text-white/50">Loading device farm dashboard...</p>
              </div>
            </div>
          )}
          <iframe
            src={farmUrl}
            title="iPhone Farm Dashboard"
            className="h-full w-full border-0"
            onLoad={() => setIframeLoaded(true)}
          />
        </div>
      </div>
    </div>
  );
}
