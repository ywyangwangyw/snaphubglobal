import Link from "next/link";
import { Hero } from "@/components/Hero";
import { ProductCard } from "@/components/ProductCard";
import { categories, featuredProducts } from "@/lib/data";

export const metadata = {
  title: "Catalog",
};

export default function CatalogPage() {
  return (
    <>
      <Hero
        eyebrow="Catalog"
        title="Curated product lines."
        subtitle="We carry a focused selection across components, devices, and industrial equipment. Pricing and availability are shared by inquiry only — we don't sell directly online."
        primaryCta={{ href: "/contact", label: "Send inquiry" }}
        size="default"
      />

      <section className="border-t border-white/10 bg-black px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Product categories
          </h2>
          <p className="mt-2 max-w-2xl text-white/50">
            Browse by line to see representative products. Contact us for the full
            range, specs, and availability.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {categories.map((cat) => (
              <div
                key={cat.slug}
                className={`rounded-2xl bg-gradient-to-b ${cat.gradient} p-8`}
              >
                <p className={`text-sm font-medium ${cat.accent}`}>
                  {cat.tagline}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {cat.name}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/50">
                  {cat.description}
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
              Sample listings
            </h2>
            <p className="mt-2 text-black/50">
              These are examples from our catalog. For pricing, stock, and
              alternatives, send an inquiry — we respond within one business day.
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
              We source beyond what&apos;s shown here. Share your part numbers or
              project details and we&apos;ll get back to you.
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
