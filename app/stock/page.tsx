import { listAdapters } from "@stockwatch/adapters";

import { AdminBar } from "@/components/AdminBar";
import { Dashboard } from "@sw/app/dashboard";
import { isDemo, loadData } from "@sw/lib/data";

import "@sw/app/globals.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Stockwatch",
  robots: { index: false, follow: false },
};

export default async function StockPage() {
  const { products, poller, stats, rates, catalog } = await loadData();
  return (
    <div className="min-h-screen bg-black">
      <AdminBar title="Stockwatch" />
      <div className="stockwatch-root" data-theme="dark">
        <Dashboard
          items={products}
          poller={poller}
          retailers={listAdapters()}
          isDemo={isDemo}
          stats={stats}
          rates={rates}
          catalog={catalog}
        />
      </div>
    </div>
  );
}
