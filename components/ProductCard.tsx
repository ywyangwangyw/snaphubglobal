import Link from "next/link";

type ProductCardProps = {
  name: string;
  category: string;
  spec: string;
  variant?: "dark" | "light";
};

const categoryColors: Record<string, string> = {
  Components: "from-blue-600/20 to-blue-900/40",
  Devices: "from-violet-600/20 to-violet-900/40",
  Industrial: "from-emerald-600/20 to-emerald-900/40",
};

export function ProductCard({
  name,
  category,
  spec,
  variant = "dark",
}: ProductCardProps) {
  const isDark = variant === "dark";

  return (
    <article
      className={`group overflow-hidden rounded-2xl transition ${
        isDark
          ? "border border-white/10 bg-[#1d1d1f] hover:border-white/20"
          : "bg-white shadow-sm hover:shadow-md"
      }`}
    >
      <div
        className={`flex h-32 items-center justify-center bg-gradient-to-br ${
          categoryColors[category] ?? "from-zinc-600/20 to-zinc-900/40"
        }`}
      >
        <div
          className={`h-16 w-16 rounded-xl border transition group-hover:scale-105 ${
            isDark ? "border-white/10 bg-white/5" : "border-black/5 bg-black/5"
          }`}
        />
      </div>

      <div className="p-6">
        <p
          className={`text-xs uppercase tracking-wider ${
            isDark ? "text-white/40" : "text-black/40"
          }`}
        >
          {category}
        </p>
        <h3
          className={`mt-2 text-lg font-semibold ${
            isDark ? "text-white" : "text-black"
          }`}
        >
          {name}
        </h3>
        <p className={`mt-1 text-sm ${isDark ? "text-white/50" : "text-black/50"}`}>
          {spec}
        </p>
        <Link
          href="/contact"
          className="mt-4 inline-block text-sm text-blue-400 transition hover:text-blue-300"
        >
          Send inquiry →
        </Link>
      </div>
    </article>
  );
}
