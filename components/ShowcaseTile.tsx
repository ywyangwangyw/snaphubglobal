import Link from "next/link";
import type { ReactNode } from "react";

const icons: Record<string, ReactNode> = {
  ai: (
    <svg viewBox="0 0 80 80" className="h-20 w-20 opacity-40" fill="none">
      <rect x="28" y="28" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M40 16v8M40 56v8M16 40h8M56 40h8M22 22l6 6M52 52l6 6M58 22l-6 6M28 52l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  gaming: (
    <svg viewBox="0 0 80 80" className="h-20 w-20 opacity-40" fill="none">
      <rect x="14" y="28" width="52" height="32" rx="8" stroke="currentColor" strokeWidth="2" />
      <path d="M28 44h8M32 40v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="48" cy="40" r="3" fill="currentColor" opacity="0.5" />
      <circle cx="54" cy="46" r="3" fill="currentColor" opacity="0.5" />
    </svg>
  ),
  infrastructure: (
    <svg viewBox="0 0 80 80" className="h-20 w-20 opacity-40" fill="none">
      <rect x="18" y="14" width="44" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="18" y="30" width="44" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="18" y="46" width="44" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="26" cy="20" r="2" fill="currentColor" opacity="0.6" />
      <circle cx="26" cy="36" r="2" fill="currentColor" opacity="0.6" />
      <circle cx="26" cy="52" r="2" fill="currentColor" opacity="0.6" />
      <path d="M34 20h22M34 36h22M34 52h22" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
    </svg>
  ),
};

type ShowcaseTileProps = {
  title: string;
  tagline: string;
  href: string;
  gradient: string;
  accent: string;
  slug: string;
  large?: boolean;
};

export function ShowcaseTile({
  title,
  tagline,
  href,
  gradient,
  accent,
  slug,
  large = false,
}: ShowcaseTileProps) {
  return (
    <Link
      href={href}
      className={`group relative overflow-hidden rounded-3xl bg-gradient-to-b ${gradient} ${
        large ? "min-h-[520px] md:col-span-2" : "min-h-[420px]"
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.1),transparent_60%)]" />
      <div className="absolute inset-0 opacity-0 transition duration-500 group-hover:opacity-100">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(41,151,255,0.12),transparent_70%)]" />
      </div>

      <div className="relative flex h-full flex-col items-center justify-between px-8 py-12 text-center">
        <div className="text-white transition duration-500 group-hover:scale-110 group-hover:opacity-60">
          {icons[slug]}
        </div>

        <div>
          <p className={`text-sm font-medium ${accent}`}>{tagline}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {title}
          </h2>
          <span className="mt-6 inline-block text-sm text-blue-400 opacity-0 transition group-hover:opacity-100">
            Learn more →
          </span>
        </div>
      </div>
    </Link>
  );
}
