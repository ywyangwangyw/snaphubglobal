import { Hero } from "@/components/Hero";

export const metadata = {
  title: "Contact",
};

export default function ContactPage() {
  return (
    <>
      <Hero
        eyebrow="Contact"
        title="Let's talk supply."
        subtitle="AI system configuration, gaming supply, server hardware, or wholesale — send your requirements and we'll follow up directly, typically within one business day."
        size="default"
      />

      <section className="bg-[#f5f5f7] px-6 py-24 text-black">
        <div className="mx-auto grid max-w-6xl gap-16 lg:grid-cols-2">
          <form className="space-y-6 rounded-3xl bg-white p-8 shadow-sm md:p-10">
            <div>
              <label htmlFor="name" className="block text-sm font-medium">
                Name
              </label>
              <input
                id="name"
                type="text"
                placeholder="Jane Smith"
                className="mt-2 w-full rounded-xl border border-black/10 bg-[#f5f5f7] px-4 py-3 text-sm outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="company" className="block text-sm font-medium">
                Company
              </label>
              <input
                id="company"
                type="text"
                placeholder="Acme Electronics"
                className="mt-2 w-full rounded-xl border border-black/10 bg-[#f5f5f7] px-4 py-3 text-sm outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="jane@acme.com"
                className="mt-2 w-full rounded-xl border border-black/10 bg-[#f5f5f7] px-4 py-3 text-sm outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="interest" className="block text-sm font-medium">
                I&apos;m interested in
              </label>
              <select
                id="interest"
                className="mt-2 w-full rounded-xl border border-black/10 bg-[#f5f5f7] px-4 py-3 text-sm outline-none transition focus:border-blue-500"
              >
                <option>AI Systems</option>
                <option>Gaming</option>
                <option>Infrastructure</option>
                <option>Wholesale inquiry</option>
                <option>General inquiry</option>
              </select>
            </div>

            <div>
              <label htmlFor="message" className="block text-sm font-medium">
                Message
              </label>
              <textarea
                id="message"
                rows={4}
                placeholder="Tell us what you need — part numbers, quantities, timeline..."
                className="mt-2 w-full resize-none rounded-xl border border-black/10 bg-[#f5f5f7] px-4 py-3 text-sm outline-none transition focus:border-blue-500"
              />
            </div>

            <button
              type="button"
              className="w-full rounded-full bg-black py-3 text-sm font-medium text-white transition hover:bg-black/80"
            >
              Send inquiry
            </button>
          </form>

          <div className="flex flex-col justify-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              Direct contact
            </h2>
            <dl className="mt-8 space-y-6">
              <div>
                <dt className="text-sm text-black/50">Sales</dt>
                <dd className="mt-1 text-lg">sales@snaphub.com</dd>
              </div>
              <div>
                <dt className="text-sm text-black/50">Support</dt>
                <dd className="mt-1 text-lg">support@snaphub.com</dd>
              </div>
              <div>
                <dt className="text-sm text-black/50">Hours</dt>
                <dd className="mt-1 text-lg">Mon–Fri · 8am–6pm ET</dd>
              </div>
              <div>
                <dt className="text-sm text-black/50">Response time</dt>
                <dd className="mt-1 text-lg">Within 1 business day</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}
