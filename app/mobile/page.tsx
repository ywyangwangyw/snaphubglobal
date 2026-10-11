import { cookies } from "next/headers";
import { createHmac } from "crypto";
import { redirect } from "next/navigation";
import { MobileDashboard } from "@/components/MobileDashboard";

export const metadata = {
  title: "Mobile Device Farm",
  robots: { index: false, follow: false },
};

function verifyToken(token: string, secret: string): boolean {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (sig !== expected) return false;
  const parts = payload.split(":");
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires)) return false;
  return Date.now() / 1000 < expires;
}

export default async function MobilePage() {
  const secret = process.env.SESSION_SECRET;
  const farmUrl = process.env.MOBILE_FARM_URL || "http://localhost:3000";

  if (!secret) {
    redirect("/mobile/login");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("snaphub_admin")?.value;

  if (!token || !verifyToken(token, secret)) {
    redirect("/mobile/login");
  }

  return <MobileDashboard farmUrl={farmUrl} />;
}
