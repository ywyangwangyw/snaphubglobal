import Image from "next/image";
import Link from "next/link";

type HeroProps = {
  eyebrow?: string;
  showBrand?: boolean;
  title: string;
  subtitle: string;
  primaryCta?: { href: string; label: string };
  secondaryCta?: { href: string; label: string };
  dark?: boolean;
  size?: "default" | "large";
};

export function Hero({
  eyebrow,
  showBrand = false,
  title,
  subtitle,
  primaryCta,
  secondaryCta,
  dark = true,
  size = "large",
}: HeroProps) {
  return (
    <section
      className={`relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden px-6 pt-12 text-center ${
        dark ? "bg-black text-white" : "bg-[#f5f5f7] text-black"
      }`}
    >
      {dark && (
        <>
          <div className="hero-glow pointer-events-none absolute inset-0" />
          <div className="pointer-events-none absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[100px]" />
          <div className="pointer-events-none absolute right-1/4 top-1/2 h-[280px] w-[280px] rounded-full bg-violet-500/10 blur-[80px]" />
        </>
      )}

      <div className="relative animate-fade-up">
        {showBrand && (
          <div className="mb-8 flex items-center justify-center gap-4">
            <Image
              src="/icon.png"
              alt="SnapHub Global"
              width={56}
              height={56}
              className="h-14 w-14 rounded-xl"
              priority
            />
            <span className="text-3xl font-semibold tracking-tight sm:text-4xl">
              SnapHub Global
            </span>
          </div>
        )}

        {eyebrow && !showBrand && (
          <p
            className={`mb-4 text-sm font-medium tracking-wide ${
              dark ? "text-blue-400" : "text-blue-600"
            }`}
          >
            {eyebrow}
          </p>
        )}

        <h1
          className={`max-w-4xl font-semibold tracking-tight ${
            size === "large"
              ? "text-5xl sm:text-6xl md:text-7xl"
              : "text-4xl sm:text-5xl md:text-6xl"
          }`}
        >
          {title}
        </h1>

        <p
          className={`mx-auto mt-6 max-w-2xl text-lg sm:text-xl ${
            dark ? "text-white/60" : "text-black/60"
          }`}
        >
          {subtitle}
        </p>

        {(primaryCta || secondaryCta) && (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            {primaryCta && (
              <Link
                href={primaryCta.href}
                className={`rounded-full px-6 py-3 text-sm font-medium transition ${
                  dark
                    ? "bg-blue-500 text-white hover:bg-blue-400"
                    : "bg-blue-600 text-white hover:bg-blue-500"
                }`}
              >
                {primaryCta.label}
              </Link>
            )}
            {secondaryCta && (
              <Link
                href={secondaryCta.href}
                className={`rounded-full px-6 py-3 text-sm font-medium transition ${
                  dark
                    ? "text-blue-400 hover:text-blue-300"
                    : "text-blue-600 hover:text-blue-500"
                }`}
              >
                {secondaryCta.label} →
              </Link>
            )}
          </div>
        )}
      </div>

      {dark && size === "large" && (
        <div className="relative mt-16 animate-fade-up-delay">
          <div className="mx-auto flex max-w-md items-end justify-center gap-3">
            <div className="product-float h-28 w-20 rounded-2xl bg-gradient-to-b from-zinc-700 to-zinc-900 shadow-2xl shadow-blue-500/10" />
            <div className="product-float-delay h-36 w-24 rounded-2xl bg-gradient-to-b from-blue-600 to-blue-900 shadow-2xl shadow-blue-500/20" />
            <div className="product-float h-32 w-20 rounded-2xl bg-gradient-to-b from-violet-700 to-violet-950 shadow-2xl shadow-violet-500/10" />
          </div>
        </div>
      )}
    </section>
  );
}
