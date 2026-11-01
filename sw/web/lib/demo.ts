/**
 * Demo data used when DATABASE_URL is not configured, so the UI renders and the
 * live lights pulse without any infrastructure. When a real DB is connected,
 * `loadData()` uses it instead and this module is never reached.
 */
import type { Product, Watch, Snapshot, StockStatus } from "@stockwatch/types";

export interface WatchView {
  watchId: string;
  retailer: string;
  /** Storefront country code, e.g. "US", "UK", "DE". */
  country: string;
  /** Product category: "gpu" (the desktop card), "laptop" (a whole notebook or
   *  laptop-class GPU variant), or "accessory" (water block, cooler, bracket,
   *  riser, PSU — a part FOR a card). Set by the poller from
   *  `classifyListingCategory`; the UI defaults to showing GPUs only so
   *  accessories/laptops don't pollute the desktop GPU product cards. */
  category: "gpu" | "desktop" | "accessory" | "laptop" | "other";
  /** Item condition: "new", "refurbished" (or renewed), "open_box", or "used". */
  condition?: "new" | "refurbished" | "open_box" | "used";
  query: string;
  pollIntervalSec: number;
  inStock: boolean;
  status: StockStatus;
  price: string | null;
  originalPrice: string | null;
  discountAmount: string | null;
  title: string | null;
  url: string | null;
  seller: string | null;
  mpn: string | null;
  imageUrl: string | null;
  updatedAt: string | null;
  /** ISO currency code from the storefront, e.g. "USD", "GBP", "EUR". */
  currency: string | null;
}

export interface ProductView {
  id: string;
  name: string;
  mpn: string | null;
  imageUrl: string | null;
  watches: WatchView[];
}

export interface PollerStatus {
  alive: boolean;
  lastBeatAt: string | null;
  watchCount: number;
  retailerCount: number;
  /** Expected seconds between heartbeats (cron=3600, daemon≈60). Drives the
   *  "alive" staleness window shown in the UI. */
  pollCycleSec?: number;
}

const RETAILERS = [
  { id: "newegg", name: "Newegg", url: "https://www.newegg.com" },
  { id: "amazon", name: "Amazon", url: "https://www.amazon.com" },
  { id: "bestbuy", name: "Best Buy", url: "https://www.bestbuy.com" },
  { id: "microcenter", name: "Micro Center", url: "https://www.microcenter.com" },
  { id: "msi", name: "MSI Store", url: "https://uk-store.msi.com" },
  { id: "ldlc", name: "LDLC", url: "https://www.ldlc.com" },
] as const;

interface DemoListing {
  status: StockStatus;
  price: number;
  title: string;
  seller: string;
  country?: string;
  currency?: string;
  originalPrice?: number | null;
  discountAmount?: number | null;
}

interface Seed {
  name: string;
  mpn: string;
  image: string;
  query: string;
  /** retailer id -> listing details. */
  listings: Record<string, DemoListing>;
}

const SEEDS: Seed[] = [
  {
    name: "NVIDIA GeForce RTX 5090 Founders Edition",
    mpn: "RTX 5090 FE",
    image:
      "https://images.unsplash.com/photo-1591488320449-011701bb6704?w=200&q=80",
    query: "rtx 5090",
    listings: {
      newegg: { status: "in_stock", price: 1999.99, title: "RTX 5090 FE", seller: "Newegg" },
      amazon: { status: "out_of_stock", price: 2449.0, title: "RTX 5090 FE (3rd party)", seller: "ScalperCo" },
      bestbuy: { status: "out_of_stock", price: 1999.99, title: "RTX 5090 FE", seller: "Best Buy" },
      // Foreign-currency listing with a discount — showcases the dual-
      // currency price block (EUR primary, USD secondary) + savings.
      ldlc: {
        status: "in_stock",
        price: 1899.95,
        originalPrice: 2099.95,
        discountAmount: 200.0,
        title: "ASUS ROG Astral RTX 5090 OC 32GB",
        seller: "LDLC",
        country: "FR",
        currency: "EUR",
      },
      msi: {
        status: "in_stock",
        price: 1929.0,
        title: "MSI GeForce RTX 5090 GAMING OC",
        seller: "MSI",
        country: "UK",
        currency: "GBP",
      },
    },
  },
  {
    name: "PlayStation 5 Pro Console",
    mpn: "CFI-7000",
    image:
      "https://images.unsplash.com/photo-1606813780859-6b9a9a9a9a9a?w=200&q=80",
    query: "ps5 pro",
    listings: {
      amazon: { status: "in_stock", price: 699.99, title: "PS5 Pro", seller: "Amazon" },
      bestbuy: { status: "in_stock", price: 699.99, title: "PS5 Pro", seller: "Best Buy" },
      newegg: { status: "unknown", price: 749.99, title: "PS5 Pro", seller: "Newegg" },
    },
  },
  {
    name: "Steam Deck OLED 1TB",
    mpn: "FJHNDZ",
    image:
      "https://images.unsplash.com/photo-1656298806298-7a9a9a9a9a9a?w=200&q=80",
    query: "steam deck oled 1tb",
    listings: {
      amazon: { status: "out_of_stock", price: 649.0, title: "Steam Deck OLED 1TB", seller: "Amazon" },
      microcenter: { status: "in_stock", price: 649.0, title: "Steam Deck OLED 1TB", seller: "Micro Center" },
    },
  },
  {
    name: "AMD Ryzen 9 9950X3D",
    mpn: "100-100001332WOF",
    image:
      "https://images.unsplash.com/photo-1555680202-c86f0e12f086?w=200&q=80",
    query: "ryzen 9 9950x3d",
    listings: {
      newegg: { status: "in_stock", price: 749.99, title: "AMD Ryzen 9 9950X3D", seller: "Newegg" },
      amazon: { status: "in_stock", price: 759.99, title: "AMD Ryzen 9 9950X3D", seller: "Amazon" },
      bestbuy: { status: "out_of_stock", price: 749.99, title: "AMD Ryzen 9 9950X3D", seller: "Best Buy" },
      microcenter: { status: "in_stock", price: 729.99, title: "AMD Ryzen 9 9950X3D", seller: "Micro Center" },
    },
  },
];

function ago(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

export function demoProducts(): ProductView[] {
  return SEEDS.map((seed, i) => {
    const productId = `demo-${i}`;
    const watches: WatchView[] = Object.entries(seed.listings).map(
      ([retailerId, listing], j) => {
        const retailer = RETAILERS.find((r) => r.id === retailerId)!;
        const watchId = `demo-${i}-${j}`;
        return {
          watchId,
          retailer: retailerId,
          country: listing.country ?? "US",
          category: "gpu",
          query: seed.query,
          pollIntervalSec: 30,
          inStock: listing.status === "in_stock",
          status: listing.status,
          price: listing.price.toFixed(2),
          originalPrice: listing.originalPrice != null ? listing.originalPrice.toFixed(2) : null,
          discountAmount: listing.discountAmount != null ? listing.discountAmount.toFixed(2) : null,
          title: listing.title,
          url: `${retailer.url}/s?query=${encodeURIComponent(seed.query)}`,
          seller: listing.seller,
          mpn: seed.mpn,
          imageUrl: null,
          updatedAt: ago(8 + j * 3 + i * 2),
          currency: listing.currency ?? "USD",
        };
      },
    );
    return {
      id: productId,
      name: seed.name,
      mpn: seed.mpn,
      imageUrl: seed.image,
      watches,
    };
  });
}

export function demoPollerStatus(): PollerStatus {
  return {
    alive: true,
    lastBeatAt: ago(4),
    watchCount: 11,
    retailerCount: 4,
    pollCycleSec: 3600,
  };
}

/** Demo SSE: periodically flip a random watch's stock to simulate live polls. */
export function randomDemoUpdate(): {
  watchId: string;
  productId: string;
  inStock: boolean;
  status: StockStatus;
  price: string | null;
  title: string | null;
  url: string | null;
  updatedAt: string;
} {
  const products = demoProducts();
  const product = products[Math.floor(Math.random() * products.length)]!;
  const watch = product.watches[Math.floor(Math.random() * product.watches.length)]!;
  const flip: StockStatus =
    watch.status === "in_stock"
      ? "out_of_stock"
      : watch.status === "out_of_stock"
        ? Math.random() > 0.5
          ? "in_stock"
          : "out_of_stock"
        : "in_stock";
  const price = watch.price ? String((Number(watch.price) * (0.98 + Math.random() * 0.04)).toFixed(2)) : null;
  return {
    watchId: watch.watchId,
    productId: product.id,
    inStock: flip === "in_stock",
    status: flip,
    price,
    title: watch.title,
    url: watch.url,
    updatedAt: new Date().toISOString(),
  };
}

export type { Product, Watch, Snapshot };
