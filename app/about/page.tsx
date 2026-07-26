import Link from "next/link";
import { Hero } from "@/components/Hero";
import { stats } from "@/lib/data";

export const metadata = {
  title: "About",
};

export default function AboutPage() {
  return (
    <>
      <Hero
        eyebrow="About SnapHub"
        title="Supply chain, simplified."
        subtitle="SnapHub LLC is an authorized electronic components and devices reseller — connecting manufacturers, resellers, and engineering teams with the parts they need, when they need them."
        primaryCta={{ href: "/contact", label: "Send inquiry" }}
        size="default"
      />

      <section className="bg-[#f5f5f7] px-6 py-24 text-black">
        <div className="mx-auto grid max-w-6xl gap-16 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">
              Our mission
            </h2>
            <p className="mt-6 leading-relaxed text-black/60">
              The electronics supply chain is complex — long lead times,
              fragmented vendors, and unclear availability slow down every
              project. SnapHub exists to simplify sourcing: a curated catalog,
              personal follow-up, and terms tailored to each inquiry.
            </p>
            <p className="mt-4 leading-relaxed text-black/60">
              We partner with authorized distributors and OEMs to source
              genuine components and enterprise devices. Every request is
              handled by our team — we don&apos;t sell directly online.
            </p>
          </div>

          <div>
            <h2 className="text-3xl font-semibold tracking-tight">
              By the numbers
            </h2>
            <dl className="mt-8 grid grid-cols-2 gap-8">
              {stats.map((item) => (
                <div key={item.label}>
                  <dt className="text-3xl font-semibold">{item.value}</dt>
                  <dd className="mt-1 text-sm text-black/50">{item.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="bg-black px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Authorized. Accountable. Inquiry-driven.
          </h2>
          <p className="mt-6 text-lg text-white/50">
            Every product we carry comes from verified supply channels. We
            stand behind authenticity, traceability, and on-time delivery — reach
            out to confirm what&apos;s available for your project.
          </p>
          <Link
            href="/contact"
            className="mt-10 inline-block text-sm text-blue-400 transition hover:text-blue-300"
          >
            Send inquiry →
          </Link>
        </div>
      </section>
    </>
  );
}
