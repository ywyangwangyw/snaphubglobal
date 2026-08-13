import Link from "next/link";
import { Hero } from "@/components/Hero";
import { ProductCard } from "@/components/ProductCard";
import { divisions, featuredProducts } from "@/lib/data";

export const metadata = {
  title: "Divisions",
};

export default function CatalogPage() {
  return (
    <>
      <Hero
        eyebrow="Divisions"
        title="Three lines. One company."
        subtitle="AI Systems, Gaming, and Infrastructure — each with its own product focus. Pricing and availability are confirmed on inquiry; we don't sell through an online catalog."
        primaryCta={{ href: "/contact", label: "Send inquiry" }}
        size="default"
      />

      <section className="border-t border-white/10 bg-black px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Business lines
          </h2>
          <p className="mt-2 max-w-2xl text-white/50">
            Explore by area to see what we source and configure. Contact us for
            specs, availability, and quotes.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {divisions.map((division) => (
              <div
                key={division.slug}
                className={`rounded-2xl bg-gradient-to-b ${division.gradient} p-8`}
              >
                <p className={`text-sm font-medium ${division.accent}`}>
                  {division.tagline}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {division.name}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/50">
                  {division.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f5f5f7] px-6 py-16 text-black">
        <div className="mx-auto max-w-4xl">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Representative examples
            </h2>
            <p className="mt-2 text-black/50">
              Illustrative product types — not a live inventory. Send an inquiry
              for current sourcing options.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {featuredProducts.map((product) => (
              <ProductCard key={product.name} {...product} variant="light" />
            ))}
          </div>

          <div className="mt-12 rounded-2xl border border-black/10 bg-white p-8 text-center">
            <p className="text-lg font-medium">Need something not listed?</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-black/50">
              We source and configure beyond what&apos;s shown here. Share your
              requirements and we&apos;ll follow up directly.
            </p>
            <Link
              href="/contact"
              className="mt-6 inline-block rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-black/80"
            >
              Send inquiry
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
