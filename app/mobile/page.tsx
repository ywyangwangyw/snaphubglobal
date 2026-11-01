import Link from "next/link";

export const metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

const TOOLS = [
  {
    href: "/mobile/farm",
    title: "iPhone Farm",
    body: "Device fleet, skills, eSIM lines, and cards.",
  },
  {
    href: "/mobile/stock",
    title: "Stockwatch",
    body: "Retailer stock, prices, and catalog for the GPUs we track.",
  },
];

export default function AdminHubPage() {
  return (
    <div className="min-h-screen bg-black px-6 py-16 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">SnapHub Global</p>
        <h1 className="mt-3 text-3xl font-semibold">Admin</h1>
        <p className="mt-3 text-sm text-white/50">
          Internal tools. Public site stays at{" "}
          <Link href="/" className="text-white/70 underline-offset-4 hover:underline">
            snaphubglobal.com
          </Link>
          .
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-2xl border border-white/10 bg-zinc-900/50 p-6 transition hover:border-white/25 hover:bg-zinc-900"
            >
              <h2 className="text-lg font-medium">{tool.title}</h2>
              <p className="mt-2 text-sm text-white/50">{tool.body}</p>
              <p className="mt-6 text-xs text-blue-400">Open →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
