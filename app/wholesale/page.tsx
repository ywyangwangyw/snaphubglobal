import Link from "next/link";
import { Hero } from "@/components/Hero";
import { wholesaleFeatures } from "@/lib/data";

export const metadata = {
  title: "Wholesale",
};

export default function WholesalePage() {
  return (
    <>
      <Hero
        eyebrow="Wholesale"
        title="Wholesale inquiries welcome."
        subtitle="Channel partners, resellers, and volume buyers — send us your requirements across gaming, AI systems, or infrastructure. We respond directly with sourcing options and per-order terms."
        primaryCta={{ href: "/contact", label: "Send inquiry" }}
        size="default"
      />

      <section className="bg-[#f5f5f7] px-6 py-24 text-black">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            How we work with partners.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-black/60">
            No self-service cart or published price lists. Every order starts
            with a conversation so we can confirm the right hardware, quantities,
            and terms for your business.
          </p>

          <div className="mt-16 grid gap-6 sm:grid-cols-2">
            {wholesaleFeatures.map((feature) => (
              <article
                key={feature.title}
                className="rounded-2xl bg-white p-8 shadow-sm"
              >
                <h3 className="text-xl font-semibold">{feature.title}</h3>
                <p className="mt-3 leading-relaxed text-black/60">
                  {feature.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-black px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            How it works
          </h2>

          <ol className="mt-16 space-y-12">
            {[
              {
                step: "01",
                title: "Send an inquiry",
                body: "Tell us about your business, product needs, and expected volumes. We aim to respond within one business day.",
              },
              {
                step: "02",
                title: "Review your options",
                body: "We share availability, lead times, and a quote tailored to your requirements — nothing is published online.",
              },
              {
                step: "03",
                title: "Confirm and fulfill",
                body: "Once terms are agreed, we handle sourcing, configuration (for AI systems), and delivery.",
              },
            ].map((item) => (
              <li key={item.step} className="flex gap-8">
                <span className="text-3xl font-semibold text-white/20">
                  {item.step}
                </span>
                <div>
                  <h3 className="text-xl font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 max-w-lg text-white/50">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-16 text-center">
            <Link
              href="/contact"
              className="inline-block rounded-full bg-blue-500 px-8 py-3 text-sm font-medium text-white transition hover:bg-blue-400"
            >
              Send inquiry
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
