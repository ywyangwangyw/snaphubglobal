import { AdminToolFrame } from "@/components/AdminToolFrame";

export const metadata = {
  title: "iPhone Farm",
  robots: { index: false, follow: false },
};

export default function FarmPage() {
  const farmUrl = process.env.MOBILE_FARM_URL ?? "";
  return (
    <AdminToolFrame
      title="iPhone Farm"
      src={farmUrl}
      emptyHint="Set MOBILE_FARM_URL to the farm dashboard (local Mac or deployed host)."
    />
  );
}
