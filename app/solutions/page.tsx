import Link from "next/link";
import { Hero } from "@/components/Hero";
import { solutions } from "@/lib/data";

export const metadata = {
  title: "Solutions",
};

export default function SolutionsPage() {
  return (
    <>
      <Hero
        eyebrow="Solutions"
        title="Built for your industry."
        subtitle="AI teams, gaming channel partners, and server resellers — each engagement starts with an inquiry and a direct follow-up."
        primaryCta={{ href: "/contact", label: "Send inquiry" }}
        secondaryCta={{ href: "/catalog", label: "Explore divisions" }}
        size="default"
      />

      <section className="bg-black px-6 py-24">
        <div className="mx-auto max-w-6xl space-y-6">
          {solutions.map((solution, i) => (
            <article
              key={solution.title}
              className={`rounded-3xl p-10 md:p-14 ${
                i % 2 === 0
                  ? "bg-[#1d1d1f] text-white"
                  : "bg-[#f5f5f7] text-black"
              }`}
            >
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {solution.title}
              </h2>
              <p
                className={`mt-4 max-w-2xl text-lg ${
                  i % 2 === 0 ? "text-white/60" : "text-black/60"
                }`}
              >
                {solution.description}
              </p>

              <ul className="mt-8 flex flex-wrap gap-3">
                {solution.stats.map((stat) => (
                  <li
                    key={stat}
                    className={`rounded-full px-4 py-2 text-sm font-medium ${
                      i % 2 === 0
                        ? "bg-white/10 text-white/80"
                        : "bg-black/5 text-black/70"
                    }`}
                  >
                    {stat}
                  </li>
                ))}
              </ul>

              <Link
                href="/contact"
                className={`mt-8 inline-block text-sm font-medium ${
                  i % 2 === 0
                    ? "text-blue-400 hover:text-blue-300"
                    : "text-blue-600 hover:text-blue-500"
                }`}
              >
                Send inquiry →
              </Link>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
