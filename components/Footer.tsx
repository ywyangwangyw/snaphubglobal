import Link from "next/link";
import { Logo } from "@/components/Logo";
import { navLinks } from "@/lib/data";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black px-6 py-12 text-sm text-white/50">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-3">
        <div>
          <Logo size="footer" />
          <p className="mt-3 max-w-xs leading-relaxed">
            Gaming supply, AI system configuration, and server infrastructure.
            B2B inquiries only — no online checkout.
          </p>
        </div>

        <div>
          <p className="mb-4 font-medium text-white/80">Explore</p>
          <ul className="space-y-2">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="transition hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-4 font-medium text-white/80">Contact</p>
          <p>sales@snaphub.com</p>
          <p className="mt-1">Mon–Fri · 8am–6pm ET</p>
        </div>
      </div>

      <p className="mx-auto mt-10 max-w-6xl text-xs">
        © {new Date().getFullYear()} SnapHub Global. All rights reserved.
      </p>
    </footer>
  );
}
