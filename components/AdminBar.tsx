"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

export function AdminBar({
  title,
  extra,
}: {
  title: string;
  extra?: ReactNode;
}) {
  const [loggingOut, setLoggingOut] = useState(false);

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
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/mobile" className="text-sm text-white/40 transition hover:text-white/70">
            ← Admin
          </Link>
          <span className="text-white/20">|</span>
          <span className="text-sm font-semibold text-white">{title}</span>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
            Admin
          </span>
        </div>
        <div className="flex items-center gap-4">
          {extra}
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
  );
}
