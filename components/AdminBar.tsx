"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TOOLS = [
  { href: "/mobile", label: "Farm" },
  { href: "/stock", label: "Stock" },
] as const;

export function AdminBar({
  title,
  extra,
}: {
  title: string;
  extra?: ReactNode;
}) {
  const pathname = usePathname();
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
          <Link href="/" className="text-sm text-white/40 transition hover:text-white/70">
            ← Home
          </Link>
          <span className="text-white/20">|</span>
          <nav className="flex items-center gap-1">
            {TOOLS.map((tool) => {
              const active = pathname === tool.href;
              return (
                <Link
                  key={tool.href}
                  href={tool.href}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/50 hover:text-white"
                  }`}
                >
                  {tool.label}
                </Link>
              );
            })}
          </nav>
          <span className="hidden text-sm font-semibold text-white sm:inline">{title}</span>
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
