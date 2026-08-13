import Link from "next/link";
import { Hero } from "@/components/Hero";
import { capabilities, divisions, industryExperience } from "@/lib/data";

export const metadata = {
  title: "About",
};

export default function AboutPage() {
  return (
    <>
      <Hero
        eyebrow="About SnapHub Global"
        title="A focused hardware company."
        subtitle="SnapHub Global is structured around three business lines — AI system configuration, gaming supply, and server infrastructure — serving resellers, channel partners, and AI teams through inquiry-based relationships."
        primaryCta={{ href: "/contact", label: "Send inquiry" }}
        size="default"
      />

      <section className="bg-[#f5f5f7] px-6 py-24 text-black">
        <div className="mx-auto grid max-w-6xl gap-16 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">
              What we do
            </h2>
            <p className="mt-6 leading-relaxed text-black/60">
              We source gaming desktops and CPUs for consumer channels, configure
              novel AI systems as a value-added reseller, and supply server
              infrastructure for industry partners. Each line has its own product
              focus, but all engagements start the same way — with a direct
              inquiry.
            </p>
            <p className="mt-4 leading-relaxed text-black/60">
              {industryExperience} We&apos;re building formal distributor and
              credit programs over time. Today, pricing and terms are quoted per
              engagement.
            </p>
          </div>

          <div>
            <h2 className="text-3xl font-semibold tracking-tight">
              How we work
            </h2>
            <dl className="mt-8 grid grid-cols-2 gap-8">
              {capabilities.map((item) => (
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
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Business lines
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-white/50">
            Three focused areas under one company.
          </p>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {divisions.map((division) => (
              <article
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
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f5f5f7] px-6 py-24 text-black">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Straightforward. Traceable. Direct.
          </h2>
          <p className="mt-6 text-lg text-black/60">
            We don&apos;t publish pricing or sell through an online cart. Every
            project is quoted individually — you know exactly what you&apos;re
            getting, from whom, and on what timeline.
          </p>
          <Link
            href="/contact"
            className="mt-10 inline-block text-sm text-blue-600 transition hover:text-blue-500"
          >
            Send inquiry →
          </Link>
        </div>
      </section>
    </>
  );
}
