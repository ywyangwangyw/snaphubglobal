import Image from "next/image";
import Link from "next/link";

type LogoProps = {
  size?: "nav" | "footer";
  onClick?: () => void;
};

export function Logo({ size = "nav", onClick }: LogoProps) {
  const isNav = size === "nav";

  return (
    <Link
      href="/"
      onClick={onClick}
      className={`group flex items-center gap-3 transition hover:opacity-90 ${
        isNav ? "min-w-0" : ""
      }`}
    >
      <Image
        src="/icon.png"
        alt="SnapHub Global"
        width={isNav ? 36 : 32}
        height={isNav ? 36 : 32}
        className={`shrink-0 rounded-lg ${isNav ? "h-9 w-9" : "h-8 w-8"}`}
        priority
      />
      <span
        className={`font-semibold tracking-tight text-white ${
          isNav
            ? "text-lg sm:text-xl"
            : "text-base"
        }`}
      >
        SnapHub Global
      </span>
    </Link>
  );
}
