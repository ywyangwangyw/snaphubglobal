import Link from "next/link";
import { Hero } from "@/components/Hero";
import { ProductCard } from "@/components/ProductCard";
import { ShowcaseTile } from "@/components/ShowcaseTile";
import {
  capabilities,
  divisions,
  featuredProducts,
  industryExperience,
} from "@/lib/data";

export default function Home() {
  return (
    <>
      <Hero
        showBrand
        title="Source. Configure. Deliver."
        subtitle="SnapHub Global sources gaming systems for consumer channels, configures novel AI platforms as a value-added reseller, and supplies server infrastructure for industry partners — all through inquiry-based B2B relationships."
        primaryCta={{ href: "/contact", label: "Send inquiry" }}
        secondaryCta={{ href: "/catalog", label: "Explore divisions" }}
      />

      <section className="animate-section border-y border-white/5 bg-black px-6 py-10">
        <p className="mx-auto max-w-3xl text-center text-sm leading-relaxed text-white/40">
          {industryExperience}
        </p>
      </section>

      <section className="bg-black px-6 py-4">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-3">
          {divisions.map((division, i) => (
            <ShowcaseTile
              key={division.slug}
              slug={division.slug}
              title={division.name}
              tagline={division.tagline}
              href={`/catalog?division=${division.slug}`}
              gradient={division.gradient}
              accent={division.accent}
              large={i === 0}
            />
          ))}
        </div>
      </section>

      <section className="animate-section bg-[#f5f5f7] px-6 py-24 text-black">
        <div className="mx-auto max-w-6xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Focused. Direct. Inquiry-first.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-black/60">
            We&apos;re a structured hardware company — not a catalog site. Share
            your requirements and we confirm sourcing options, configuration
            details, and lead time personally.
          </p>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((item) => (
              <div key={item.label}>
                <p className="text-4xl font-semibold tracking-tight">
                  {item.value}
                </p>
                <p className="mt-2 text-sm text-black/50">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="animate-section bg-black px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Representative lines.
            </h2>
            <p className="mt-4 text-lg text-white/50">
              Examples of what we source and configure. Full range available on
              inquiry.
            </p>
          </div>

          <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
            {featuredProducts.map((product) => (
              <ProductCard key={product.name} {...product} variant="dark" />
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link
              href="/contact"
              className="text-sm text-blue-400 transition hover:text-blue-300"
            >
              Ask about other products →
            </Link>
          </div>
        </div>
      </section>

      <section className="animate-section bg-[#f5f5f7] px-6 py-24 text-black">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Start with a conversation.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-black/60">
            Whether you&apos;re an AI team needing a configured platform, a
            channel partner sourcing gaming systems, or a reseller looking for
            server hardware — reach out and we&apos;ll follow up directly.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/contact"
              className="rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-black/80"
            >
              Send inquiry
            </Link>
            <Link
              href="/wholesale"
              className="rounded-full px-6 py-3 text-sm font-medium text-blue-600 transition hover:text-blue-500"
            >
              Wholesale inquiries →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
