import Link from "next/link";
import type { ReactNode } from "react";

const icons: Record<string, ReactNode> = {
  components: (
    <svg viewBox="0 0 80 80" className="h-20 w-20 opacity-40" fill="none">
      <rect x="16" y="16" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="2" />
      <rect x="24" y="24" width="12" height="12" rx="2" fill="currentColor" opacity="0.6" />
      <rect x="44" y="24" width="12" height="12" rx="2" fill="currentColor" opacity="0.4" />
      <rect x="24" y="44" width="12" height="12" rx="2" fill="currentColor" opacity="0.4" />
      <rect x="44" y="44" width="12" height="12" rx="2" fill="currentColor" opacity="0.6" />
    </svg>
  ),
  devices: (
    <svg viewBox="0 0 80 80" className="h-20 w-20 opacity-40" fill="none">
      <rect x="20" y="12" width="40" height="56" rx="4" stroke="currentColor" strokeWidth="2" />
      <rect x="26" y="18" width="28" height="38" rx="2" fill="currentColor" opacity="0.3" />
      <circle cx="40" cy="62" r="3" fill="currentColor" opacity="0.5" />
    </svg>
  ),
  industrial: (
    <svg viewBox="0 0 80 80" className="h-20 w-20 opacity-40" fill="none">
      <circle cx="40" cy="40" r="20" stroke="currentColor" strokeWidth="2" />
      <circle cx="40" cy="40" r="8" fill="currentColor" opacity="0.4" />
      <path d="M40 20v-6M40 66v-6M20 40h-6M66 40h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
