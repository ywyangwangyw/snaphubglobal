import Link from "next/link";
import { Hero } from "@/components/Hero";
import { ProductCard } from "@/components/ProductCard";
import { ShowcaseTile } from "@/components/ShowcaseTile";
import { categories, featuredProducts, partners, stats } from "@/lib/data";

export default function Home() {
  return (
    <>
      <Hero
        eyebrow="SnapHub LLC"
        title="Electronics. Sourced. Delivered."
        subtitle="A curated B2B reseller for components, devices, and industrial gear. We work by inquiry — tell us what you need and our team handles the rest."
        primaryCta={{ href: "/contact", label: "Send inquiry" }}
        secondaryCta={{ href: "/catalog", label: "View product lines" }}
      />

      <section className="animate-section border-y border-white/5 bg-black px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {partners.map((partner) => (
            <span
              key={partner}
              className="text-sm font-medium tracking-wide text-white/30"
            >
              {partner}
            </span>
          ))}
        </div>
      </section>

      <section className="bg-black px-6 py-4">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-3">
          {categories.map((cat, i) => (
            <ShowcaseTile
              key={cat.slug}
              slug={cat.slug}
              title={cat.name}
              tagline={cat.tagline}
              href={`/catalog?category=${cat.slug}`}
              gradient={cat.gradient}
              accent={cat.accent}
              large={i === 0}
            />
          ))}
        </div>
      </section>

      <section className="animate-section bg-[#f5f5f7] px-6 py-24 text-black">
        <div className="mx-auto max-w-6xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Inquiry-first. No checkout required.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-black/60">
            We don&apos;t sell directly online. Share your requirements and we&apos;ll
            confirm availability, lead time, and terms personally.
          </p>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((item) => (
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
              Sample product lines.
            </h2>
            <p className="mt-4 text-lg text-white/50">
              A small selection of what we source. Full range available on inquiry.
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
            Have a project in mind?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-black/60">
            Whether you need a single part or a full BOM, reach out and our team
            will follow up with options — no online cart, no published pricing.
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
              Wholesale partnerships →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
