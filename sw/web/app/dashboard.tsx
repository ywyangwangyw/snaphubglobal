"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { PollerStatus, ProductView, WatchView } from "@sw/lib/demo";
import type { PollStats, CoverageCell, MetricRow, PollMetrics, WatchQueueItem } from "@sw/lib/live";
import type { UsdRates } from "@sw/lib/data";
import type { CatalogIdKind, CatalogItem, CatalogProduct, CatalogType, MpnSource } from "@sw/lib/catalog";
import { Dropdown } from "@sw/components/select";
import { HistoryChart } from "./history-chart";

interface DashboardProps {
  items: ProductView[];
  poller: PollerStatus;
  retailers: string[];
  isDemo: boolean;
  /** Catalog: retailer-id catalog items grouped into products (see lib/catalog). */
  catalog: CatalogProduct[];
  stats: PollStats | null;
  rates: UsdRates;
}

/** Badge for non-new listings. `condition` is resolved server-side
 *  (`lib/condition.ts`) from the poller's stored flag + title/SKU heuristics. */
function ConditionBadge({ condition }: { condition: WatchView["condition"] }) {
  if (condition === "refurbished") {
    return (
      <span className="badge cat-renewed" title="Renewed / Refurbished">
        Renewed
      </span>
    );
  }
  if (condition === "open_box") {
    return (
      <span className="badge cat-renewed" title="Open box">
        Open box
      </span>
    );
  }
  if (condition === "used") {
    return (
      <span className="badge cat-renewed" title="Used">
        Used
      </span>
    );
  }
  return null;
}

const RETAILER_NAMES: Record<string, string> = {
  newegg: "Newegg",
  amazon: "Amazon",
  bestbuy: "Best Buy",
  microcenter: "Micro Center",
  walmart: "Walmart",
  bhphoto: "B&H Photo",
  staples: "Staples",
  cdw: "CDW",
  arrow: "Arrow",
  asus: "ASUS Store",
  msi: "MSI Store",
  gigabyte: "GIGABYTE",
  nvidia: "NVIDIA",
  ldlc: "LDLC",
};

/** Display labels for the country codes we track. */
const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  UK: "United Kingdom",
  DE: "Germany",
  FR: "France",
};

/** Flag emoji per country code (for the colorful country pills). */
const COUNTRY_FLAGS: Record<string, string> = {
  US: "🇺🇸",
  CA: "🇨🇦",
  UK: "🇬🇧",
  DE: "🇩🇪",
  FR: "🇫🇷",
};

/** CSS class for a category badge/ribbon. */
function catClass(category: string | undefined): string {
  if (category === "laptop") return "cat-laptop";
  if (category === "accessory") return "cat-accessory";
  if (category === "desktop") return "cat-desktop";
  if (category && category !== "gpu") return "cat-other";
  return "cat-gpu";
}
function catLabel(category: string | undefined): string {
  if (category === "laptop") return "Laptop";
  if (category === "accessory") return "Accessory";
  if (category === "desktop") return "Desktop";
  if (category && category !== "gpu") return category;
  return "GPU";
}

/** Currency symbol per ISO code (stored on each listing's raw payload). */
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "C$",
};

function currencySymbol(code: string | null): string {
  return (code && CURRENCY_SYMBOL[code]) || "$";
}

/**
 * Convert a foreign-currency amount to USD using the loaded exchange rates.
 * `rates[CUR]` = how many CUR one USD buys (e.g. EUR: 0.92 ⇒ 1 USD = €0.92),
 * so USD = amount / rate. Unknown/missing currencies are assumed already USD.
 */
function toUsd(amount: number | null | undefined, currency: string | null, rates: UsdRates): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (!currency || currency === "USD") return amount;
  const r = rates.rates[currency];
  if (!r || r <= 0) return amount; // unknown currency → treat as USD rather than crash
  return amount / r;
}

/** Format a USD number with thousands separators + 2 decimals. */
function fmtUsd(v: number | null): string {
  return v == null ? "—" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type View = "overview" | "catalog" | "polling" | "add" | "history";
/** Sections of the Polling page, each on its own sub-tab. */
type PollSub = "queue" | "coverage" | "pipelines";
const VIEWS: readonly View[] = ["overview", "catalog", "polling", "add", "history"];
const POLL_SUBS: readonly PollSub[] = ["queue", "coverage", "pipelines"];

/** Pages live in the URL hash — `#polling/coverage` — so they're linkable
 *  and survive a reload without touching the (single-route) app shell. */
/** `#<view>` · `#polling/<sub>` · `#polling/queue/<watchId>` (detail layer). */
function parseHash(hash: string): { view: View; sub: PollSub; detail: string | null } | null {
  const [v, s, d] = hash.replace(/^#/, "").split("/");
  if (!v || !(VIEWS as readonly string[]).includes(v)) return null;
  const sub = s && (POLL_SUBS as readonly string[]).includes(s) ? (s as PollSub) : "queue";
  const detail = v === "polling" && sub === "queue" && d ? decodeURIComponent(d) : null;
  return { view: v as View, sub, detail };
}
type StockFilter = "all" | "in" | "out";
type SortKey = "price-asc" | "price-desc" | "name" | "newest";

/** Numeric USD price for sorting; null/missing sorts as +∞ so it lands last.
 *  Converts via the loaded rates so cross-currency listings compare fairly. */
function priceKey(w: WatchView, rates: UsdRates): number {
  const usd = toUsd(w.price == null ? null : Number(w.price), w.currency, rates);
  return usd == null ? Infinity : usd;
}

/** Sort a list of listings by the selected key. Null prices always go last. */
function sortWatches(ws: WatchView[], sort: SortKey, rates: UsdRates): WatchView[] {
  const arr = [...ws];
  // Null/missing price sorts last regardless of direction.
  const byPrice = (dir: 1 | -1) => (a: WatchView, b: WatchView) => {
    const an = priceKey(a, rates) === Infinity;
    const bn = priceKey(b, rates) === Infinity;
    if (an || bn) return an === bn ? 0 : an ? 1 : -1;
    return (priceKey(a, rates) - priceKey(b, rates)) * dir;
  };
  switch (sort) {
    case "price-asc":
      arr.sort(byPrice(1));
      break;
    case "price-desc":
      arr.sort(byPrice(-1));
      break;
    case "name":
      arr.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
      break;
    case "newest":
      arr.sort(
        (a, b) =>
          new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
      );
      break;
  }
  return arr;
}

function relTime(iso: string | null, now: number | null): string {
  if (now == null) return "—";
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function Dashboard({ items, poller, retailers, isDemo, stats, rates, catalog }: DashboardProps) {
  const [live, setLive] = useState(items);
  const [pollerState, setPollerState] = useState(poller);
  const [statsState, setStatsState] = useState<PollStats | null>(stats);
  // True while a fetch cycle is in flight (signalled by the SSE stream) —
  // turns every row's indicator light purple to show active fetching.
  const [polling, setPolling] = useState(false);
  // `now` starts null so the first client render matches the server render
  // (avoids hydration mismatches from Date.now() differing across the two).
  // It's set on mount, then ticks every second.
  const [now, setNow] = useState<number | null>(null);
  // Pages (top nav): Overview / Polling / History / Add. Keeps the overview
  // clean by moving the dense polling panel + add form onto their own pages.
  // The Polling page is further split into sub-tabs. Both sync to the hash.
  const [view, setViewState] = useState<View>("overview");
  const [pollSub, setPollSubState] = useState<PollSub>("queue");
  // Product-group detail layer on the poll queue, addressed by its anchor
  // watch id in the hash so it can be linked to and survives reload.
  const [queueDetail, setQueueDetailState] = useState<string | null>(null);
  useEffect(() => {
    const apply = () => {
      const p = parseHash(window.location.hash);
      if (p) {
        setViewState(p.view);
        setPollSubState(p.sub);
        setQueueDetailState(p.detail);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const setView = (v: View) => {
    setViewState(v);
    setQueueDetailState(null);
    window.history.replaceState(null, "", v === "polling" ? `#polling/${pollSub}` : `#${v}`);
  };
  const setPollSub = (s: PollSub) => {
    setPollSubState(s);
    setQueueDetailState(null);
    window.history.replaceState(null, "", `#polling/${s}`);
  };
  const setQueueDetail = (id: string | null) => {
    setQueueDetailState(id);
    // Opening pushes a history entry so Back closes the layer; closing
    // rewrites in place so it never leaves the page.
    if (id) window.history.pushState(null, "", `#polling/queue/${encodeURIComponent(id)}`);
    else window.history.replaceState(null, "", "#polling/queue");
  };
  // Product whose full-listings modal is open (null = no modal). Replaces the
  // old in-card expand, which could stretch a card across the whole grid when
  // a model had 50+ listings.
  const [modalProduct, setModalProduct] = useState<ProductView | null>(null);
  // Overview filters: stock status + retailer + sort + free-text search.
  // Defaults: in-stock only, price low→high — the most useful "what can I
  // buy cheapest right now" view.
  const [stockFilter, setStockFilter] = useState<StockFilter>("in");
  const [retailerFilter, setRetailerFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  // Default to GPUs only so accessories (water blocks, coolers, brackets…)
  // don't pollute the GPU product cards — switch to "all" to surface them.
  const [categoryFilter, setCategoryFilter] = useState<string>("gpu");
  const [sort, setSort] = useState<SortKey>("price-asc");
  const [query, setQuery] = useState("");

  // Last time each WATCH was polled (from the queue), keyed by watch id. A
  // listing's own `updatedAt` is its last *change* (snapshots are written on
  // change only), so rows use this to show "checked 3m ago" instead of a
  // misleading "161h ago" for a listing that's simply been stable.
  const checkedByWatch = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of statsState?.queue ?? []) if (q.lastPollAt) m.set(q.watchId, q.lastPollAt);
    return m;
  }, [statsState?.queue]);

  // Retailers actually present in the live data (drives the retailer dropdown).
  const retailersInUse = useMemo(() => {
    const set = new Set<string>();
    for (const p of live) for (const w of p.watches) set.add(w.retailer);
    return [...set].sort();
  }, [live]);

  // Countries actually present in the live data (drives the country dropdown).
  const countriesInUse = useMemo(() => {
    const set = new Set<string>();
    for (const p of live) for (const w of p.watches) set.add(w.country);
    return [...set].sort();
  }, [live]);

  // Tick the clock + relative-time labels every second (client-only).
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Color theme. Scoped to .stockwatch-root so the public SnapHub pages stay dark.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const root = document.querySelector(".stockwatch-root") as HTMLElement | null;
    const stored = (() => {
      try {
        return localStorage.getItem("sw-theme");
      } catch {
        return null;
      }
    })();
    const t = (stored ?? root?.dataset.theme) as "dark" | "light" | undefined;
    if (t === "light" || t === "dark") {
      setTheme(t);
      if (root) root.dataset.theme = t;
    }
  }, []);
  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      const root = document.querySelector(".stockwatch-root") as HTMLElement | null;
      if (root) root.dataset.theme = next;
      try {
        localStorage.setItem("sw-theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Live updates over SSE. In demo mode the stream emits simulated snapshots;
  // with a real DB it streams NOTIFY-driven snapshots from the poller.
  useEffect(() => {
    setLive(items);
    setPollerState(poller);
    let es: EventSource | null = null;
    const open = () => {
      // Don't open a second stream, and don't poll while the tab is hidden —
      // letting the SSE idle when no one is watching is what lets Neon's
      // compute auto-suspend so the project stays on the $0 free tier.
      if (es || (typeof document !== "undefined" && document.hidden)) return;
      const stream = new EventSource("/api/stream");
      es = stream;
      // A fetch cycle is starting — turn the row indicators purple.
      stream.addEventListener("poll-start", () => {
        setPolling(true);
        // A poll starting means the poller is alive — refresh its heartbeat so
        // it never reads "Down" just because every fetch failed this cycle.
        setPollerState((p) => ({ ...p, alive: true, lastBeatAt: new Date().toISOString() }));
      });
      stream.addEventListener("poll-end", () => {
        setPolling(false);
        setPollerState((p) => ({ ...p, alive: true, lastBeatAt: new Date().toISOString() }));
      });
      stream.addEventListener("stats", (e) => {
        try {
          setStatsState(JSON.parse((e as MessageEvent).data) as PollStats);
        } catch {
          /* ignore malformed stats */
        }
      });
      // Per-watch schedule refresh (DB mode, every ~60s): merge into stats so
      // the queue view + "checked Xm ago" labels track the poller live.
      stream.addEventListener("queue", (e) => {
        try {
          const queue = JSON.parse((e as MessageEvent).data) as WatchQueueItem[];
          setStatsState((s) => (s ? { ...s, queue } : s));
          // The newest per-watch poll is the most honest liveness signal.
          let newest = 0;
          for (const q of queue) if (q.lastPollAt) newest = Math.max(newest, new Date(q.lastPollAt).getTime());
          if (newest > 0) {
            setPollerState((p) => {
              const cur = p.lastBeatAt ? new Date(p.lastBeatAt).getTime() : 0;
              return newest > cur ? { ...p, alive: true, lastBeatAt: new Date(newest).toISOString() } : p;
            });
          }
        } catch {
          /* ignore malformed queue */
        }
      });
      stream.addEventListener("snapshot", (e) => {
        const snap = JSON.parse((e as MessageEvent).data) as {
          watchId: string;
          productId: string;
          retailer: string;
          country: string;
          category: WatchView["category"] | null;
          condition?: WatchView["condition"];
          seller?: string | null;
          currency: string | null;
          inStock: boolean;
          status: WatchView["status"];
          price: string | null;
          originalPrice: string | null;
          discountAmount: string | null;
          title: string | null;
          mpn: string | null;
          url: string | null;
          /** Per-listing image (from snapshots.image_url) — one image per
           *  retailer SKU/MPN, so each card model gets its own photo. Falls
           *  back to productImageUrl (per-series) in LinkRow if this fails. */
          imageUrl: string | null;
          productImageUrl: string | null;
          updatedAt: string;
        };
        // Defensive: ignore placeholder snapshots with no retailer SKU — they
        // would render as a fake "Newegg" dummy row. (The poller no longer
        // writes these, but a stale SSE connection could still emit one.)
        if (!snap.mpn) return;
        setLive((prev) =>
          prev.map((p) => {
            if (p.id !== snap.productId) return p;
            // Refresh the product's catalog image from the SSE event so it
            // stays populated even without a full page reload.
            const productImageUrl = snap.productImageUrl ?? p.imageUrl;
            // Upsert: update the matching watch if it exists, otherwise append it
            // as a new row (the SSR starts with empty watches, so the first
            // snapshot for each listing must be added, not just updated).
            const existing = p.watches.find((w) => w.watchId === snap.watchId);
            const updated = {
              watchId: snap.watchId,
              // Use the retailer the stream reports — NOT a hardcoded label.
              // (Hardcoding "newegg" here used to relabel MSI rows as Newegg
              // after the first SSE poll.)
              retailer: snap.retailer,
              country: snap.country ?? existing?.country ?? "US",
              category: (snap.category ?? existing?.category ?? "gpu") as WatchView["category"],
              condition: (snap.condition ?? existing?.condition ?? "new") as WatchView["condition"],
              currency: snap.currency ?? existing?.currency ?? null,
              query: existing?.query ?? "",
              pollIntervalSec: existing?.pollIntervalSec ?? 60,
              inStock: snap.inStock,
              status: snap.status,
              price: snap.price,
              originalPrice: snap.originalPrice ?? existing?.originalPrice ?? null,
              discountAmount: snap.discountAmount ?? existing?.discountAmount ?? null,
              title: snap.title,
              mpn: snap.mpn ?? existing?.mpn ?? null,
              url: snap.url,
              seller: snap.seller ?? existing?.seller ?? null,
              // Per-listing image (one per retailer SKU/MPN). Falls back to
              // the per-series productImageUrl in LinkRow on load failure.
              imageUrl: snap.imageUrl ?? existing?.imageUrl ?? null,
              updatedAt: snap.updatedAt,
            };
            const watches = existing
              ? p.watches.map((w) => (w.watchId === snap.watchId ? updated : w))
              : [...p.watches, updated];
            return { ...p, imageUrl: productImageUrl, watches };
          }),
        );
        // A snapshot arriving means the poller just ran — refresh its heartbeat.
        // Snapshots are write-on-change, so `updatedAt` is the last *change*
        // (possibly days old) and must never move the heartbeat backwards.
        setPollerState((p) => {
          const cur = p.lastBeatAt ? new Date(p.lastBeatAt).getTime() : 0;
          const inc = snap.updatedAt ? new Date(snap.updatedAt).getTime() : 0;
          return { ...p, alive: true, lastBeatAt: inc > cur ? snap.updatedAt : p.lastBeatAt };
        });
      });
    };
    const close = () => {
      es?.close();
      es = null;
    };
    // Pause the SSE stream (and its DB polling) when the tab is hidden so Neon
    // can auto-suspend; resume the moment the tab is visible again.
    const onVis = () => {
      if (document.hidden) close();
      else open();
    };
    if (typeof document !== "undefined") {
      if (!document.hidden) open();
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      close();
    };
  }, [items, poller]);

  const summary = useMemo(() => {
    let inStock = 0;
    let out = 0;
    let links = 0;
    for (const p of live) {
      for (const w of p.watches) {
        links++;
        if (w.status === "in_stock") inStock++;
        else if (w.status === "out_of_stock") out++;
      }
    }
    return { products: live.length, inStock, out, links };
  }, [live]);

  // Apply the overview filters to listings within each product.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return live.map((p) => {
      let ws = p.watches.filter((w) => {
        if (stockFilter === "in" && w.status !== "in_stock") return false;
        if (stockFilter === "out" && w.status !== "out_of_stock") return false;
        if (retailerFilter !== "all" && w.retailer !== retailerFilter) return false;
        if (countryFilter !== "all" && w.country !== countryFilter) return false;
        if (categoryFilter !== "all" && w.category !== categoryFilter) return false;
        if (q) {
          const hay = `${w.title ?? ""} ${w.mpn ?? ""} ${w.seller ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      ws = sortWatches(ws, sort, rates);
      return { ...p, watches: ws };
    });
  }, [live, stockFilter, retailerFilter, countryFilter, categoryFilter, sort, query, rates]);

  const pollerAgeSec =
    now != null && pollerState.lastBeatAt
      ? Math.max(0, Math.round((now - new Date(pollerState.lastBeatAt).getTime()) / 1000))
      : null;
  // Cron-aware liveness: tolerate up to 1.5× the poller's beat cycle (hourly
  // for the GitHub Actions cron poller) before flipping to "down" — otherwise
  // an hourly cron poller would look dead for the 59 minutes between runs.
  // Before the client has a clock (`now` is null at SSR), trust the server's
  // `alive` flag rather than forcing "down" (which would flash "Down" on
  // every server render even when the poller is healthy).
  const pollCycleSec = pollerState.pollCycleSec ?? 3600;
  const aliveWindowSec = Math.max(90, Math.round(pollCycleSec * 1.5));
  const pollerAlive = pollerState.alive && (pollerAgeSec == null || pollerAgeSec < aliveWindowSec);

  return (
    <div className="wrap">
      {/* Top bar */}
      <div className="topbar">
        <div className="brand">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l2-7 4 14 2-7h6" />
            </svg>
          </div>
          <div>
            <h1>
              stockwatch
              {isDemo && (
                <span className="demo-badge live">
                  <span className="light in" style={{ width: 7, height: 7 }} /> live · newegg
                </span>
              )}
            </h1>
            <div className="tag">Real-time inventory across retailers</div>
          </div>
        </div>

        {/* Pages — top navigation */}
        <nav className="topnav" aria-label="Pages">
          <a href="#overview" className={`navtab ${view === "overview" ? "active" : ""}`} aria-current={view === "overview" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setView("overview"); }}>
            Overview
            <span className="navtab-badge">{summary.links}</span>
          </a>
          <a href="#catalog" className={`navtab ${view === "catalog" ? "active" : ""}`} aria-current={view === "catalog" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setView("catalog"); }}>
            Catalog
            <span className="navtab-badge">{catalog.length}</span>
          </a>
          <a href="#polling" className={`navtab ${view === "polling" ? "active" : ""}`} aria-current={view === "polling" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setView("polling"); }}>
            Polling
            {statsState && <span className={`navtab-dot ${statsState.rateLimitedCount > 0 ? "warn" : "ok"}`} />}
          </a>
          <a href="#history" className={`navtab ${view === "history" ? "active" : ""}`} aria-current={view === "history" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setView("history"); }}>
            History
          </a>
          <a href="#add" className={`navtab ${view === "add" ? "active" : ""}`} aria-current={view === "add" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setView("add"); }}>
            Add product
          </a>
        </nav>

        <div className="topbar-right">
          <div className="clock">
            {now == null
              ? "--:--:--"
              : new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle color theme"
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M19.4 4.6l-1.8 1.8M6.4 17.6l-1.8 1.8" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {view === "overview" && (
        <>
          {/* Poller status */}
          <div className="poller">
            <span className="label">Poller</span>
            <span className="state">
              <span className={`light ${pollerAlive ? "in" : "out"}`} />
              {pollerAlive ? "Live" : "Down"}
            </span>
            <span className="meta">
              {!pollerState.lastBeatAt
                ? "no heartbeat"
                : `last beat ${relTime(pollerState.lastBeatAt, now)} · ${pollerState.watchCount} watches · ${pollerState.retailerCount} retailers`}
            </span>
          </div>

          {/* Stats */}
          <div className="stats">
            <div className="stat">
              <div className="n">{summary.products}</div>
              <div className="l">Products</div>
            </div>
            <div className="stat green">
              <div className="n">{summary.inStock}</div>
              <div className="l">In stock</div>
            </div>
            <div className="stat red">
              <div className="n">{summary.out}</div>
              <div className="l">Out of stock</div>
            </div>
            <div className="stat">
              <div className="n">{summary.links}</div>
              <div className="l">Links watched</div>
            </div>
          </div>

          {/* Exchange rates — all prices are shown in USD; this bar shows the
              rates used so foreign-site prices are transparent. */}
          <ExchangeRateBar rates={rates} />

          {/* Filters */}
          <div className="filters">
            <div className="filter-group">
              <Dropdown
                ariaLabel="Stock status"
                value={stockFilter}
                onValueChange={(v) => setStockFilter(v as StockFilter)}
                options={[
                  { value: "all", label: "All stock" },
                  { value: "in", label: "In stock" },
                  { value: "out", label: "Out of stock" },
                ]}
              />
              <Dropdown
                ariaLabel="Retailer"
                value={retailerFilter}
                onValueChange={setRetailerFilter}
                options={[
                  { value: "all", label: "All retailers" },
                  ...retailersInUse.map((r) => ({ value: r, label: RETAILER_NAMES[r] ?? r })),
                ]}
              />
              <Dropdown
                ariaLabel="Country"
                value={countryFilter}
                onValueChange={setCountryFilter}
                options={[
                  { value: "all", label: "All countries" },
                  ...countriesInUse.map((c) => ({ value: c, label: COUNTRY_NAMES[c] ?? c })),
                ]}
              />
              <Dropdown
                ariaLabel="Product category"
                value={categoryFilter}
                onValueChange={setCategoryFilter}
                options={[
                  { value: "gpu", label: "Desktop GPUs" },
                  { value: "desktop", label: "Prebuilt Desktops" },
                  { value: "laptop", label: "Laptops" },
                  { value: "accessory", label: "Accessories" },
                  { value: "all", label: "All categories" },
                ]}
              />
              <Dropdown
                ariaLabel="Sort"
                value={sort}
                onValueChange={(v) => setSort(v as SortKey)}
                options={[
                  { value: "price-asc", label: "Price: low to high" },
                  { value: "price-desc", label: "Price: high to low" },
                  { value: "name", label: "Name: A–Z" },
                  { value: "newest", label: "Newest" },
                ]}
              />
            </div>
            <input
              className="filter-search"
              placeholder="Filter listings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Product cards */}
          {live.length === 0 ? (
            <div className="empty">No products yet. Add one to start tracking.</div>
          ) : (
            <div className="grid">
              {filtered.map((p, i) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  now={now}
                  index={i}
                  polling={polling}
                  modelStatus={statsState?.perModel.find((m) => m.id === p.id) ?? null}
                  onViewAll={() => setModalProduct(p)}
                  rates={rates}
                  checked={checkedByWatch}
                />
              ))}
            </div>
          )}
        </>
      )}

      {view === "polling" && statsState && (
        <PollStatsPanel
          stats={statsState}
          now={now}
          polling={polling}
          live={live}
          sub={pollSub}
          onSub={setPollSub}
          queueDetail={queueDetail}
          onQueueDetail={setQueueDetail}
          onWatchesToggled={(ids, enabled) => {
            // Optimistic: the next SSE `queue` event (≤60s) confirms from the DB.
            const set = new Set(ids);
            setStatsState((s) =>
              s
                ? { ...s, queue: s.queue.map((q) => (set.has(q.watchId) ? { ...q, enabled, nextDueAt: enabled ? q.nextDueAt : null } : q)) }
                : s,
            );
          }}
          onIntervalSet={(ids, sec) => {
            // Optimistic mirror of data.ts: sub-cycle intervals run as-is in
            // the fast daemon; longer ones round up to whole cron cycles.
            const set = new Set(ids);
            const cycle = pollCycleSec;
            setStatsState((s) =>
              s
                ? {
                    ...s,
                    queue: s.queue.map((q) => {
                      if (!set.has(q.watchId)) return q;
                      const effective = q.mode === "product" || sec < cycle ? sec : Math.ceil(sec / cycle) * cycle;
                      const nextDueAt = q.enabled && q.lastPollAt ? new Date(new Date(q.lastPollAt).getTime() + effective * 1000).toISOString() : q.nextDueAt;
                      return { ...q, pollIntervalSec: sec, effectiveIntervalSec: effective, nextDueAt };
                    }),
                  }
                : s,
            );
          }}
        />
      )}

      {view === "history" && (
        <div className="history-grid">
          {live.length === 0 ? (
            <div className="empty">No products to chart yet.</div>
          ) : (
            live.map((p) => (
              <HistoryChart key={p.id} productId={p.id} productName={p.name} />
            ))
          )}
        </div>
      )}

      {view === "add" && <AddForm retailers={retailers} />}

      {view === "catalog" && <CatalogPage products={catalog} />}

      {modalProduct && (
        <ListingsModal
          product={modalProduct}
          now={now}
          polling={polling}
          onClose={() => setModalProduct(null)}
          rates={rates}
          checked={checkedByWatch}
        />
      )}
    </div>
  );
}

function ProductCard({
  product,
  now,
  index,
  polling,
  modelStatus,
  onViewAll,
  rates,
  checked,
}: {
  product: ProductView;
  now: number | null;
  index: number;
  polling: boolean;
  modelStatus: import("@sw/lib/live").ModelPollStatus | null;
  onViewAll: () => void;
  rates: UsdRates;
  checked: Map<string, string>;
}) {
  const inStockCount = product.watches.filter((w) => w.status === "in_stock").length;
  const rateLimited = modelStatus?.state === "rate_limited";
  const errored = modelStatus?.state === "error";
  const modelPolling = modelStatus?.state === "polling";
  const empty = product.watches.length === 0;
  // Cards show only the first few listings inline; the rest live in a modal so
  // a 50-listing model can't balloon the card and wreck the grid layout.
  const PREVIEW = 3;
  const shown = product.watches.slice(0, PREVIEW);
  const hidden = product.watches.length - shown.length;

  return (
    <div className="card" style={{ animationDelay: `${index * 60}ms` }}>
      <span className={`cat-banner ${catClass(product.watches[0]?.category ?? (product.mpn?.endsWith("Desktop") ? "desktop" : "gpu"))}`}>
        {catLabel(product.watches[0]?.category ?? (product.mpn?.endsWith("Desktop") ? "desktop" : "gpu"))}
      </span>
      <div className="card-head">
        <div className="info">
          <h2>{product.name}</h2>
          <div className="mpn">{product.mpn ? `MPN ${product.mpn}` : "no MPN"}</div>
        </div>
        <div className="count">
          {inStockCount}/{product.watches.length} in stock
          {hidden > 0 && <span className="expand-hint">{hidden} more</span>}
        </div>
      </div>
      <div className="links">
        {shown.map((w) => (
          <LinkRow key={w.watchId} w={w} now={now} polling={polling} rates={rates} checkedAt={checkedAtFor(w, checked)} />
        ))}
        {hidden > 0 && (
          <button className="show-more" onClick={onViewAll}>
            View all {product.watches.length} listings
          </button>
        )}
        {empty && modelPolling && (
          <div className="row-status polling">
            <span className="light fetching" /> Polling…
          </div>
        )}
        {empty && rateLimited && (
          <div className="row-status rate-limited">
            <span className="light fetching" /> Rate-limited — backing off, retrying.
          </div>
        )}
        {empty && errored && (
          <div className="row-status error">
            <span className="light out" /> Fetch error — {modelStatus?.lastError ?? "unknown"}
          </div>
        )}
        {empty && !rateLimited && !errored && !modelPolling && (
          <div className="row-status empty">
            <span className="light unknown" /> No first-party listings found.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Full-listings modal. Lists every listing for a product, grouped by MPN so
 * that when the same SKU appears at multiple retailers those rows sit together
 * (each row still shows its own retailer). In-stock groups float to the top.
 */
function ListingsModal({
  product,
  now,
  polling,
  onClose,
  rates,
  checked,
}: {
  product: ProductView;
  now: number | null;
  polling: boolean;
  onClose: () => void;
  rates: UsdRates;
  checked: Map<string, string>;
}) {
  // Group listings by MPN (fall back to the listing title when there's no SKU).
  const groups = useMemo(() => {
    const map = new Map<string, WatchView[]>();
    for (const w of product.watches) {
      const key = w.mpn?.trim() || w.title?.trim() || w.watchId;
      const arr = map.get(key) ?? [];
      arr.push(w);
      map.set(key, arr);
    }
    const list = [...map.entries()].map(([key, rows]) => {
      const inStock = rows.filter((w) => w.status === "in_stock").length;
      return { key, rows, inStock, anyInStock: inStock > 0 };
    });
    // In-stock groups first, then by first retailer name for stable order.
    return list.sort((a, b) => {
      if (a.anyInStock !== b.anyInStock) return a.anyInStock ? -1 : 1;
      // Retailer may be undefined for some watches (e.g. live-mode listings
      // without a resolved retailer key); fall back to "" so localeCompare
      // never receives undefined.
      const ar = a.rows[0]?.retailer;
      const br = b.rows[0]?.retailer;
      const an = (ar ? RETAILER_NAMES[ar] ?? ar : "") || "";
      const bn = (br ? RETAILER_NAMES[br] ?? br : "") || "";
      return an.localeCompare(bn);
    });
  }, [product.watches]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>{product.name}</h2>
            <div className="mpn">{product.mpn ? `MPN ${product.mpn}` : "no MPN"}</div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-summary">
          {product.watches.filter((w) => w.status === "in_stock").length}/{product.watches.length} in stock
          {" · "}
          {groups.length} SKU{groups.length === 1 ? "" : "s"} across{" "}
          {new Set(product.watches.map((w) => w.retailer)).size} retailer
          {new Set(product.watches.map((w) => w.retailer)).size === 1 ? "" : "s"}
          {" · "}
          {new Set(product.watches.map((w) => w.country)).size} countr
          {new Set(product.watches.map((w) => w.country)).size === 1 ? "y" : "ies"}
        </div>
        <div className="modal-body">
          {groups.map((g) => (
            <div key={g.key} className="mpn-group">
              {g.rows.length > 1 && (
                <div className="mpn-group-head">
                  {g.key} · {g.rows.length} retailers
                </div>
              )}
              {g.rows.map((w) => (
                <LinkRow key={w.watchId} w={w} now={now} polling={polling} rates={rates} checkedAt={checkedAtFor(w, checked)} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExchangeRateBar({ rates }: { rates: UsdRates }) {
  // Only show the foreign currencies we actually track in listings — not the
  // full Frankfurter feed (~30 currencies), which would be a wall of numbers.
  // Stable, friendly order; USD is the base so it's not listed.
  const tracked = ["GBP", "EUR", "CAD"];
  const entries = tracked.filter((c) => rates.rates[c] != null);
  return (
    <div className="fxbar" title={`All prices converted to USD. Rates as of ${rates.asOf}.`}>
      <span className="fxbar-label">All prices in USD</span>
      <span className="fxbar-sep" aria-hidden>·</span>
      <span className="fxbar-rates">
        {entries.map((c) => {
          const r = rates.rates[c]!;
          return (
            <span className="fxbar-rate" key={c}>
              <span className="fxbar-cur">{currencySymbol(c)}</span>
              <span className="fxbar-val">{r.toFixed(r < 2 ? 4 : 2)}</span>
              <span className="fxbar-per">/ $1</span>
            </span>
          );
        })}
      </span>
      <span className="fxbar-asof">as of {rates.asOf}</span>
    </div>
  );
}

/** Per-listing thumbnail that hides itself on load failure (e.g. Newegg CDN
 *  400s on hotlinks) revealing the neutral placeholder behind it. Uses React
 *  state — not a direct DOM style mutation — so the hidden state survives
 *  SSE-triggered re-renders. Checks both onError AND onLoad(naturalWidth===0)
 *  because a cached 404 response sometimes fires onLoad with a zero-width
 *  image instead of onError. */
function ThumbImg({ src, alt }: { src: string; alt?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [errored, setErrored] = useState(false);
  // Check on mount + when src changes: a cached 404 can leave the img
  // complete with naturalWidth===0 without ever firing onError.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setErrored(true);
  }, [src]);
  if (errored) return null;
  return (
    <img
      ref={ref}
      className="rowthumb img-overlay"
      src={src}
      alt={alt ?? ""}
      onError={() => setErrored(true)}
      onLoad={(e) => {
        if (e.currentTarget.naturalWidth === 0) setErrored(true);
      }}
    />
  );
}

/** Last time the WATCH owning listing `w` was polled. Listing ids are
 *  `<watchId>/<sku>` (or a bare watch id). */
function checkedAtFor(w: WatchView, checked: Map<string, string>): string | null {
  const watchId = w.watchId.split("/")[0] ?? w.watchId;
  return checked.get(watchId) ?? null;
}

function LinkRow({
  w,
  now,
  polling,
  rates,
  checkedAt,
}: {
  w: WatchView;
  now: number | null;
  polling: boolean;
  rates: UsdRates;
  /** When the owning watch was last polled (null if unknown). */
  checkedAt: string | null;
}) {
  const cls = w.status === "in_stock" ? "in" : w.status === "out_of_stock" ? "out" : "unknown";
  const label =
    w.status === "in_stock" ? "In stock" : w.status === "out_of_stock" ? "Out of stock" : "Unknown";
  const retailerName = w.retailer ? (RETAILER_NAMES[w.retailer] ?? w.retailer) : "";
  // "Checked" = last poll of the owning watch (the freshness that matters);
  // "changed" = this listing's last snapshot (snapshots are write-on-change,
  // so a stable listing's updatedAt can be days old while it's checked hourly).
  // If the last poll predates the last change (queue not loaded yet), the
  // change time is the best lower bound on freshness.
  const checkedIso =
    checkedAt && (!w.updatedAt || new Date(checkedAt).getTime() >= new Date(w.updatedAt).getTime())
      ? checkedAt
      : w.updatedAt;
  const ageSec =
    now != null && checkedIso
      ? Math.max(0, Math.round((now - new Date(checkedIso).getTime()) / 1000))
      : null;
  const fresh = ageSec != null && ageSec < 6;
  const changedAgo =
    w.updatedAt && checkedIso && checkedIso !== w.updatedAt && now != null &&
    new Date(checkedIso).getTime() - new Date(w.updatedAt).getTime() > 3600_000
      ? relTime(w.updatedAt, now)
      : null;

  // While a fetch cycle is in flight the light goes purple + pulses to signal
  // "actively fetching/updating this item", overriding the stock colour.
  const lightCls = polling ? "fetching" : `${cls} ${fresh ? "" : "stale"}`;

  // Convert every price to USD so cross-country listings compare apples-to-
  // apples. The original foreign price is kept as a `title` tooltip on the
  // price block for reference.
  const usdPrice = toUsd(w.price == null ? null : Number(w.price), w.currency, rates);
  const usdOriginal = toUsd(
    w.originalPrice == null ? null : Number(w.originalPrice),
    w.currency,
    rates,
  );
  const usdSavings = toUsd(
    w.discountAmount == null ? null : Number(w.discountAmount),
    w.currency,
    rates,
  );
  const hasDiscount =
    usdOriginal != null && usdSavings != null && usdSavings > 0 && usdPrice != null && usdOriginal > usdPrice;

  // Show both currencies when the listing's original price is not USD: the
  // foreign price is primary, the USD equivalent is a smaller secondary line.
  const isForeign = !!w.currency && w.currency !== "USD";
  const cur = currencySymbol(w.currency);
  const fmtMoney = (v: number | null | undefined) =>
    v == null ? "—" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fNow = w.price != null ? `${cur}${fmtMoney(Number(w.price))}` : null;
  const fWas = hasDiscount && w.originalPrice != null ? `${cur}${fmtMoney(Number(w.originalPrice))}` : null;
  const fOff = hasDiscount && w.discountAmount != null ? `${cur}${fmtMoney(Number(w.discountAmount))}` : null;
  const uNow = w.price != null ? `$${fmtUsd(usdPrice)}` : "—";
  const uWas = hasDiscount ? `$${fmtUsd(usdOriginal)}` : null;
  const uOff = hasDiscount ? `$${fmtUsd(usdSavings)}` : null;

  const origStr =
    w.price != null
      ? `${currencySymbol(w.currency)}${Number(w.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}${
          w.originalPrice != null && Number(w.originalPrice) > Number(w.price)
            ? ` (was ${currencySymbol(w.currency)}${Number(w.originalPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })})`
            : ""
        }`
      : "";

  return (
    <a
      className="link"
      href={w.url ?? "#"}
      target={w.url ? "_blank" : undefined}
      rel="noreferrer"
      title={`${retailerName} — ${label}`}
    >
      <span className={`light ${lightCls}`} />
      <span className="rowthumb-wrap">
        <span className="rowthumb ph" aria-hidden>▣</span>
        {w.imageUrl && (
          <ThumbImg src={`/api/img?u=${encodeURIComponent(w.imageUrl)}`} />
        )}
      </span>
      <span className="title">
        <span className="title-name">{w.title || retailerName}</span>
        <span className="title-sub badges">
          <span className={`badge ret-${w.retailer}`}>{retailerName}</span>
          {w.country && (
            <span className={`badge c-${w.country}`} title={COUNTRY_NAMES[w.country] ?? w.country}>
              <span className="flag">{COUNTRY_FLAGS[w.country] ?? ""}</span>
              {w.country}
            </span>
          )}
          <ConditionBadge condition={w.condition} />
          {w.mpn && <span className="badge-text">{w.mpn}</span>}
          {w.category === "accessory" && <span className="badge cat-accessory">Accessory</span>}
          {w.category === "laptop" && <span className="badge cat-laptop">Laptop</span>}
          {w.category === "desktop" && <span className="badge cat-desktop">Desktop</span>}
        </span>
      </span>
      <span className="spacer" />
      <span
        className={`price ${w.price == null ? "muted" : ""}`}
        title={origStr ? `Original: ${origStr}` : undefined}
      >
        {isForeign ? (
          <>
            <span className="price-line">
              {hasDiscount && <span className="price-was">{fWas}</span>}
              {fNow ?? "—"}
            </span>
            <span className="price-line price-usd">
              {hasDiscount && <span className="price-was">{uWas}</span>}
              {uNow}
            </span>
            {hasDiscount && <span className="price-off">−{fOff} (−{uOff})</span>}
          </>
        ) : (
          <>
            <span className="price-line">
              {hasDiscount && <span className="price-was">{uWas}</span>}
              {uNow}
            </span>
            {hasDiscount && <span className="price-off">−{uOff}</span>}
          </>
        )}
      </span>
      <span
        className="ago"
        title={
          checkedIso
            ? `Last checked ${relTime(checkedIso, now)}${changedAgo ? ` · last changed ${changedAgo}` : ""}`
            : undefined
        }
      >
        <span className="ago-checked">checked {relTime(checkedIso, now)}</span>
        {changedAgo && <span className="ago-changed">changed {changedAgo}</span>}
      </span>
      <svg
        className="ext"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
    </a>
  );
}

/**
 * Per-(retailer, country) coverage matrix for the Polling tab. Renders a grid
 * with retailers as rows and countries as columns; each cell is colour-coded
 * by pipeline state so it's obvious which storefronts are live, which are
 * polling but empty, and which are disabled (an unreachable storefront we
 * deliberately turned off — e.g. Akamai-gated Newegg CA, non-existent MSI CA).
 */
function CoverageMatrix({ coverage }: { coverage: CoverageCell[] }) {
  if (coverage.length === 0) return null;
  const retailers = [...new Set(coverage.map((c) => c.retailer))].sort();
  const countries = [...new Set(coverage.map((c) => c.country))].sort();
  const byKey = new Map(coverage.map((c) => [`${c.retailer}|${c.country}`, c]));

  // Cell state: disabled (no enabled watches / not configured) / ok / empty.
  const stateOf = (cell: CoverageCell | undefined): "ok" | "empty" | "disabled" => {
    if (!cell || cell.enabledWatches === 0) return "disabled";
    return cell.listingCount > 0 ? "ok" : "empty";
  };

  // Count over the FULL matrix (every retailer × country cell), so the
  // footer matches the visible grid — "off" includes both deliberately
  // disabled storefronts and retailer/country pairs we never configured.
  let liveCount = 0;
  let emptyCount = 0;
  let offCount = 0;
  for (const r of retailers) {
    for (const c of countries) {
      const s = stateOf(byKey.get(`${r}|${c}`));
      if (s === "ok") liveCount++;
      else if (s === "empty") emptyCount++;
      else offCount++;
    }
  }

  return (
    <div className="ps-coverage">
      <div className="ps-coverage-head">
        <span className="ps-coverage-title">Storefront coverage</span>
        <span className="ps-coverage-legend">
          <span className="ps-leg ok"><span className="light in" /> live</span>
          <span className="ps-leg empty"><span className="light fetching" /> polling</span>
          <span className="ps-leg disabled"><span className="light out" /> off</span>
        </span>
      </div>
      <table className="ps-cov-table">
        <thead>
          <tr>
            <th />
            {countries.map((c) => (
              <th key={c}>
                <span className={`badge c-${c}`} title={COUNTRY_NAMES[c] ?? c}>
                  <span className="flag">{COUNTRY_FLAGS[c] ?? ""}</span>
                  {c}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {retailers.map((r) => (
            <tr key={r}>
              <th scope="row">
                <span className={`badge ret-${r}`}>{RETAILER_NAMES[r] ?? r}</span>
              </th>
              {countries.map((c) => {
                const cell = byKey.get(`${r}|${c}`);
                const state = stateOf(cell);
                const label =
                  state === "disabled"
                    ? "off"
                    : cell!.listingCount > 0
                      ? String(cell!.listingCount)
                      : "0";
                const title = cell
                  ? `${RETAILER_NAMES[r] ?? r} · ${COUNTRY_NAMES[c] ?? c} — ${cell.enabledWatches}/${cell.totalWatches} watches, ${cell.listingCount} listing(s)`
                  : `${RETAILER_NAMES[r] ?? r} · ${COUNTRY_NAMES[c] ?? c} — not configured`;
                return (
                  <td key={c} className={`ps-cov-cell ${state}`} title={title}>
                    <span className={`light ${state === "ok" ? "in" : state === "empty" ? "fetching" : "out"}`} />
                    <span className="ps-cov-n">{label}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ps-coverage-foot">
        {liveCount} live · {emptyCount} polling · {offCount} off
      </div>
    </div>
  );
}

function PollStatsPanel({
  stats,
  now,
  polling,
  live,
  sub,
  onSub,
  queueDetail,
  onQueueDetail,
  onWatchesToggled,
  onIntervalSet,
}: {
  stats: PollStats;
  now: number | null;
  polling: boolean;
  live: ProductView[];
  sub: PollSub;
  onSub: (s: PollSub) => void;
  queueDetail: string | null;
  onQueueDetail: (id: string | null) => void;
  onWatchesToggled: (ids: string[], enabled: boolean) => void;
  onIntervalSet: (ids: string[], sec: number) => void;
}) {
  const backingOff = !!stats.backoffUntil;
  const nextIn = stats.nextPollInSec ?? 0;
  const nextInLabel =
    nextIn >= 60 ? `${Math.round(nextIn / 60)}m` : `${nextIn}s`;
  // Most recent poll of *anything*: the hourly heartbeat or any per-watch
  // poll (the 60s product watches run on a separate daemon).
  let lastPollMs = stats.lastPollAt ? new Date(stats.lastPollAt).getTime() : 0;
  for (const q of stats.queue) {
    if (q.lastPollAt) lastPollMs = Math.max(lastPollMs, new Date(q.lastPollAt).getTime());
  }
  const lastAge =
    lastPollMs > 0 && now != null ? Math.max(0, Math.round((now - lastPollMs) / 1000)) : null;
  const okCount = stats.perModel.filter((m) => m.state === "ok").length;
  const rlCount = stats.perModel.filter((m) => m.state === "rate_limited").length;

  const stateLabel = polling
    ? "Fetching now…"
    : backingOff
      ? `Backing off · retry in ${nextInLabel}`
      : `Idle · next poll in ${nextInLabel}`;
  const stateLight = polling ? "fetching" : backingOff ? "out" : "in";

  return (
    <div className="pollstats">
      <div className="ps-head">
        <span className="ps-title">
          <span className={`light ${stateLight}`} /> Polling
        </span>
        <span className={`ps-state ${backingOff ? "warn" : ""}`}>{stateLabel}</span>
      </div>
      <div className="ps-grid">
        <div className="ps-metric">
          <div className="ps-n">{stats.totalSearches}</div>
          <div className="ps-l">Searches</div>
        </div>
        <div className="ps-metric green">
          <div className="ps-n">{stats.successCount}</div>
          <div className="ps-l">Succeeded</div>
        </div>
        <div className="ps-metric red">
          <div className="ps-n">{stats.rateLimitedCount}</div>
          <div className="ps-l">Rate-limited</div>
        </div>
        <div className="ps-metric">
          <div className="ps-n">{stats.failCount - stats.rateLimitedCount}</div>
          <div className="ps-l">Other errors</div>
        </div>
        <div className="ps-metric">
          <div className="ps-n">{okCount}/{stats.perModel.length}</div>
          <div className="ps-l">Models OK</div>
        </div>
        <div className="ps-metric">
          <div className="ps-n">{lastAge == null ? "—" : `${fmtDur(lastAge)} ago`}</div>
          <div className="ps-l">Last poll</div>
        </div>
      </div>
      <div className="ps-tuned">
        <span className="ps-tune">
          <span className="ps-tune-n">{stats.gateConcurrency}</span> concurrent
        </span>
        <span className="ps-tune">
          <span className="ps-tune-n">{stats.gateSpacingMs}</span>ms spacing
        </span>
        <span className="ps-tune">
          <span className="ps-tune-n">{stats.proxyCount}</span> {stats.proxyCount === 1 ? "proxy" : "proxies"}
        </span>
        <span className="ps-tune-hint">
          {stats.proxyCount > 0
            ? "auto-tuned · rotates IPs on 429"
            : "auto-tuned AIMD · backs off on 429"}
        </span>
      </div>
      {rlCount > 0 && (
        <div className="ps-rl">
          Newegg is rate-limiting this IP (HTTP 429). The poller backs off and
          retries automatically — no bursts. {stats.lastError ? `Last: ${stats.lastError}.` : ""}
        </div>
      )}
      <div className="ps-models">
        {stats.perModel.map((m) => (
          <span key={m.id} className={`ps-chip ${m.state}`}>
            <span className={`light ${m.state === "ok" ? "in" : m.state === "rate_limited" ? "fetching" : m.state === "error" ? "out" : "unknown"}`} />
            {m.name.replace("NVIDIA GeForce ", "")}
            <span className="ps-chip-n">{m.listingCount}</span>
          </span>
        ))}
      </div>
      {/* Sections as sub-tabs: the queue is the working view; coverage and
          pipeline analytics are reference views you open on demand. */}
      <div className="subtabs" role="tablist" aria-label="Polling sections">
        {(
          [
            ["queue", "Poll queue", `${stats.queue.filter((q) => q.enabled).length}`],
            ["coverage", "Storefront coverage", `${stats.coverage.filter((c) => c.enabledWatches > 0).length}`],
            ["pipelines", "Pipelines", `${stats.metrics.rows.length}`],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={sub === id}
            className={`subtab ${sub === id ? "active" : ""}`}
            onClick={() => onSub(id)}
          >
            {label}
            <span className="navtab-badge">{n}</span>
          </button>
        ))}
      </div>
      {sub === "queue" && (
        <PollQueue
          queue={stats.queue}
          now={now}
          live={live}
          pollerAlive={!backingOff}
          detailId={queueDetail}
          onDetail={onQueueDetail}
          onToggled={onWatchesToggled}
          onIntervalSet={onIntervalSet}
        />
      )}
      {sub === "coverage" && <CoverageMatrix coverage={stats.coverage} />}
      {sub === "pipelines" && <MetricsPanel metrics={stats.metrics} />}
    </div>
  );
}

/** On/off switch used for a country or a storefront. A real `switch` role
 *  with a visible track + state word, sized for a fingertip. */
function PowerSwitch({
  on,
  busy,
  label,
  onToggle,
  compact,
}: {
  on: boolean;
  busy?: boolean;
  label: string;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={busy}
      className={`pswitch ${on ? "on" : "off"} ${busy ? "busy" : ""} ${compact ? "compact" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <span className="pswitch-track" aria-hidden="true">
        <span className="pswitch-knob" />
      </span>
      {!compact && <span className="pswitch-text">{busy ? "…" : on ? "Polling" : "Paused"}</span>}
    </button>
  );
}

/**
 * Poll queue: every enabled watch grouped by storefront (retailer × country),
 * with its last poll (when + outcome), the interval it actually runs at, and
 * when it's next due — counting down live. Sites are ordered by soonest-due
 * so the top of the list is what the poller will hit next. This is the
 * "is each site actually being checked, and when is the next check" view;
 * a stable listing can show "changed 161h ago" on the overview while its
 * watch here shows "polled 12m ago · next in 48m".
 */
function PollQueue({
  queue,
  now,
  live,
  pollerAlive,
  detailId,
  onDetail,
  onToggled,
  onIntervalSet,
}: {
  queue: WatchQueueItem[];
  now: number | null;
  live: ProductView[];
  pollerAlive: boolean;
  /** Anchor watch id of the product group whose detail modal is open (from the URL hash). */
  detailId: string | null;
  onDetail: (id: string | null) => void;
  onToggled: (ids: string[], enabled: boolean) => void;
  onIntervalSet: (ids: string[], sec: number) => void;
}) {
  // Country filter — keeps the page short when you only care about one
  // market. Remembered across reloads.
  const [country, setCountry] = useState<string>("all");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("sw.pollCountry");
      if (saved) setCountry(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const pickCountry = (c: string) => {
    setCountry(c);
    try {
      window.localStorage.setItem("sw.pollCountry", c);
    } catch {
      /* ignore */
    }
  };

  // Enable/disable or re-time a slice (a storefront, a whole country, or one
  // product at one storefront). The server updates `watches`; the poller
  // picks it up on its next reconcile/cycle.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);
  const patch = async (
    key: string,
    sel: { retailer?: string; country?: string; productId?: string },
    change: { enabled?: boolean; pollIntervalSec?: number },
  ) => {
    setPending((p) => new Set(p).add(key));
    setToggleError(null);
    try {
      const res = await fetch("/api/watches", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sel, ...change }),
      });
      const data = (await res.json().catch(() => ({}))) as { ids?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (change.enabled != null) onToggled(data.ids ?? [], change.enabled);
      if (change.pollIntervalSec != null) onIntervalSet(data.ids ?? [], change.pollIntervalSec);
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  };
  const toggle = (key: string, sel: { retailer?: string; country?: string }, enabled: boolean) => patch(key, sel, { enabled });

  // Per-country rollup for the filter bar: how many watches, how many on.
  const countries = useMemo(() => {
    const m = new Map<string, { total: number; on: number }>();
    for (const q of queue) {
      const c = m.get(q.country) ?? { total: 0, on: 0 };
      c.total++;
      if (q.enabled) c.on++;
      m.set(q.country, c);
    }
    return [...m.entries()].map(([code, c]) => ({ code, ...c })).sort((a, b) => a.code.localeCompare(b.code));
  }, [queue]);

  const visible = useMemo(() => (country === "all" ? queue : queue.filter((q) => q.country === country)), [queue, country]);
  // Current listings per watch, from the overview data (watch ids are
  // `<watchId>/<sku>`), so the queue shows what each watch is surfacing and
  // the detail modal can lay them out as cards.
  const listingsByWatch = useMemo(() => {
    const m = new Map<string, WatchListing[]>();
    for (const p of live) {
      for (const w of p.watches) {
        const id = w.watchId.split("/")[0] ?? w.watchId;
        const arr = m.get(id) ?? [];
        arr.push({ w, productImage: p.imageUrl, productName: p.name });
        m.set(id, arr);
      }
    }
    return m;
  }, [live]);

  // Storefront → product groups. Within a storefront, a product's search
  // watch and the product-URL watches tracking that same product are one
  // section: the search row is the product row, URL watches nest under it.
  // (The router hands a search hit to the URL watch that owns the page, so
  // e.g. MSI "RTX 5090" reads 0 on its own while its six URL rows hold the
  // items — grouping them makes that one picture.)
  const groups = useMemo(() => {
    const bySite = new Map<string, WatchQueueItem[]>();
    for (const q of visible) {
      const k = `${q.retailer}|${q.country}`;
      const arr = bySite.get(k) ?? [];
      arr.push(q);
      bySite.set(k, arr);
    }
    const dueMs = (q: WatchQueueItem) => (q.nextDueAt ? new Date(q.nextDueAt).getTime() : 0);
    const list = [...bySite.entries()].map(([key, items]) => {
      const [retailer, country] = key.split("|") as [string, string];
      const enabledItems = items.filter((q) => q.enabled);
      // Storefront timing: the slowest watch in the last run is what the run
      // actually waited on (watches fire in parallel); the median of the
      // per-watch 24h medians is the storefront's typical cost.
      const lastDur = enabledItems.map((q) => q.lastDurationMs).filter((d): d is number => d != null);
      const p50s = enabledItems.map((q) => q.p50DurationMs).filter((d): d is number => d != null).sort((a, b) => a - b);
      const failing = enabledItems.filter((q) => q.lastStatus === "error" || q.lastStatus === "rate_limited").length;
      // Stock rollup across the storefront's listings (each listing belongs
      // to exactly one watch, so summing per-watch counts doesn't double up).
      let found = 0;
      let inStock = 0;
      for (const q of items) {
        for (const l of listingsByWatch.get(q.watchId) ?? []) {
          found++;
          if (l.w.status === "in_stock") inStock++;
        }
      }
      // Product groups within the storefront.
      const byProduct = new Map<string, WatchQueueItem[]>();
      for (const q of items) {
        const arr = byProduct.get(q.productId) ?? [];
        arr.push(q);
        byProduct.set(q.productId, arr);
      }
      const products: ProductGroup[] = [...byProduct.entries()].map(([productId, ws]) => {
        const search = ws.find((q) => q.mode === "search") ?? null;
        const urls = ws.filter((q) => q.mode === "product").sort((a, b) => dueMs(a) - dueMs(b));
        const anchor = search ?? urls[0]!;
        const on = ws.filter((q) => q.enabled);
        const intervals = new Set(ws.map((q) => q.pollIntervalSec));
        return {
          key: `${key}|${productId}`,
          retailer,
          country,
          productId,
          productName: anchor.productName,
          search,
          urls,
          items: ws,
          anchor,
          enabled: on.length > 0,
          nextDue: on.length ? Math.min(...on.map(dueMs)) : Infinity,
          intervalSec: intervals.size === 1 ? [...intervals][0]! : null,
        };
      });
      products.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.nextDue - b.nextDue || a.productName.localeCompare(b.productName));
      return {
        key,
        retailer,
        country,
        items,
        products,
        found,
        inStock,
        enabledCount: enabledItems.length,
        // A storefront is "on" if any of its watches is; the toggle flips all.
        enabled: enabledItems.length > 0,
        nextDue: enabledItems.length ? Math.min(...enabledItems.map(dueMs)) : Infinity,
        lastRunMs: lastDur.length ? Math.max(...lastDur) : null,
        sumLastMs: lastDur.length ? lastDur.reduce((a, b) => a + b, 0) : null,
        p50Ms: p50s.length ? p50s[Math.floor(p50s.length / 2)]! : null,
        failing,
      };
    });
    // Live storefronts by soonest-due; disabled ones sink to the bottom.
    return list.sort(
      (a, b) => Number(b.enabled) - Number(a.enabled) || a.nextDue - b.nextDue || a.retailer.localeCompare(b.retailer),
    );
  }, [visible, listingsByWatch]);

  // The product group whose detail is open. Resolved from the whole queue
  // (not just the visible slice) so a deep link works regardless of the
  // country filter.
  const detailGroup = useMemo(() => {
    if (!detailId) return null;
    const anchor = queue.find((q) => q.watchId === detailId);
    if (!anchor) return null;
    const ws = queue.filter((q) => q.retailer === anchor.retailer && q.country === anchor.country && q.productId === anchor.productId);
    const search = ws.find((q) => q.mode === "search") ?? null;
    const urls = ws.filter((q) => q.mode === "product");
    const intervals = new Set(ws.map((q) => q.pollIntervalSec));
    const pg: ProductGroup = {
      key: `${anchor.retailer}|${anchor.country}|${anchor.productId}`,
      retailer: anchor.retailer,
      country: anchor.country,
      productId: anchor.productId,
      productName: anchor.productName,
      search,
      urls,
      items: ws,
      anchor: search ?? anchor,
      enabled: ws.some((q) => q.enabled),
      nextDue: 0,
      intervalSec: intervals.size === 1 ? [...intervals][0]! : null,
    };
    return pg;
  }, [queue, detailId]);

  // Across storefronts: the run's critical path is the slowest storefront.
  const slowest = useMemo(
    () => groups.reduce<(typeof groups)[number] | null>((m, g) => (g.lastRunMs != null && (m == null || g.lastRunMs > (m.lastRunMs ?? 0)) ? g : m), null),
    [groups],
  );

  const enabledCount = visible.filter((q) => q.enabled).length;
  const disabledSites = groups.filter((g) => !g.enabled).length;

  if (queue.length === 0) {
    return (
      <div className="ps-queue">
        <div className="ps-coverage-head">
          <span className="ps-coverage-title">Poll queue</span>
          <span className="ps-metrics-empty">No watches scheduled</span>
        </div>
      </div>
    );
  }

  const dueCount = now == null ? 0 : visible.filter((q) => q.nextDueAt && new Date(q.nextDueAt).getTime() <= now).length;
  const fast = visible.filter((q) => q.enabled && q.effectiveIntervalSec < 3600).length;

  return (
    <div className="ps-queue">
      <div className="ps-coverage-head">
        <span className="ps-coverage-title">Poll queue</span>
        <span className="ps-metrics-summary">
          {enabledCount} watches across {groups.length - disabledSites} storefronts
          {disabledSites > 0 && <> · <span className="ps-metrics-off">{disabledSites} {disabledSites === 1 ? "site" : "sites"} off</span></>}
          {fast > 0 && <> · <span className="ps-metrics-lat">{fast} sub-hourly</span></>}
          {" · "}
          <span className={dueCount > 0 ? "ps-metrics-rate warn" : "ps-metrics-rate ok"}>{dueCount} due now</span>
          {slowest?.lastRunMs != null && (
            <>
              {" · "}
              <span title="Watches run in parallel, so the slowest storefront bounds the run">
                slowest site{" "}
                <span className={`ps-metrics-lat ${durTone(slowest.lastRunMs)}`}>
                  {RETAILER_NAMES[slowest.retailer] ?? slowest.retailer} {slowest.country} {fmtMs(slowest.lastRunMs)}
                </span>
              </span>
            </>
          )}
        </span>
      </div>

      {/* Country filter + per-country on/off. Filtering is local; the power
          button flips every watch in that country on the server. */}
      <div className="ps-qfilter" role="toolbar" aria-label="Filter poll queue by country">
        <span className="ps-qfilter-label">Country</span>
        <button type="button" className={`ps-qchip ps-qchip-all ${country === "all" ? "active" : ""}`} onClick={() => pickCountry("all")}>
          All <span className="ps-qchip-n">{queue.length}</span>
        </button>
        {countries.map((c) => {
          const on = c.on > 0;
          const partial = on && c.on < c.total;
          const busy = pending.has(`country:${c.code}`);
          const name = COUNTRY_NAMES[c.code] ?? c.code;
          return (
            <span key={c.code} className={`ps-qchip ${country === c.code ? "active" : ""} ${on ? "" : "off"}`}>
              <button
                type="button"
                className="ps-qchip-pick"
                onClick={() => pickCountry(c.code)}
                title={`Show only ${name}`}
                aria-pressed={country === c.code}
              >
                <span className="flag">{COUNTRY_FLAGS[c.code] ?? ""}</span>
                <span className="ps-qchip-code">{c.code}</span>
                <span className="ps-qchip-n" title={partial ? `${c.on} of ${c.total} watches polling` : `${c.total} watches`}>
                  {partial ? `${c.on}/${c.total}` : c.total}
                </span>
              </button>
              <PowerSwitch
                compact
                on={on}
                busy={busy}
                label={on ? `Pause polling for all ${name} storefronts` : `Resume polling for ${name}`}
                onToggle={() => void toggle(`country:${c.code}`, { country: c.code }, !on)}
              />
            </span>
          );
        })}
        <span className="ps-qfilter-hint">Switch pauses or resumes every storefront in that country</span>
        {toggleError && <span className="ps-qfilter-err">Couldn’t update: {toggleError}</span>}
      </div>

      {groups.length === 0 && <div className="ps-metrics-empty ps-qfilter-empty">No watches for this country</div>}
      {groups.map((g) => (
        <div key={g.key} className={`ps-site ${g.enabled ? "" : "disabled"}`}>
          <div className="ps-site-head">
            <span className="badges">
              <span className={`badge ret-${g.retailer}`}>{RETAILER_NAMES[g.retailer] ?? g.retailer}</span>
              <span className={`badge c-${g.country}`} title={COUNTRY_NAMES[g.country] ?? g.country}>
                <span className="flag">{COUNTRY_FLAGS[g.country] ?? ""}</span>
                {g.country}
              </span>
              {!g.enabled && <span className="ps-site-off">polling off</span>}
              {g.enabled && g.enabledCount < g.items.length && (
                <span className="ps-site-off partial" title={`${g.items.length - g.enabledCount} of ${g.items.length} watches disabled`}>
                  {g.enabledCount}/{g.items.length} on
                </span>
              )}
              {g.failing > 0 && (
                <span className="ps-site-fail" title={`${g.failing} of ${g.items.length} watches failed their last poll`}>
                  {g.failing} failing
                </span>
              )}
              {g.found > 0 && (
                <span
                  className={`ps-site-stock ${g.inStock > 0 ? "in" : "out"}`}
                  title={`${g.inStock} of ${g.found} listings at this storefront are in stock`}
                >
                  <span className={`light ${g.inStock > 0 ? "in" : "out"}`} />
                  {g.inStock}/{g.found} in stock
                </span>
              )}
            </span>
            <span className="ps-site-meta">
              {g.lastRunMs != null && (
                <span
                  className="ps-site-dur"
                  title={
                    `Last run: slowest watch ${fmtMs(g.lastRunMs)}` +
                    (g.sumLastMs != null ? `, ${fmtMs(g.sumLastMs)} summed across ${g.items.length} watches` : "") +
                    (g.p50Ms != null ? `. Typical (24h median per watch): ${fmtMs(g.p50Ms)}` : "")
                  }
                >
                  <span className={`ps-dur ${durTone(g.lastRunMs)}`}>{fmtMs(g.lastRunMs)}</span>
                  {g.p50Ms != null && <span className="ps-dur-p50"> · typ {fmtMs(g.p50Ms)}</span>}
                </span>
              )}
              {g.products.length} {g.products.length === 1 ? "product" : "products"} · {g.items.length} {g.items.length === 1 ? "watch" : "watches"}
              {g.enabled ? (
                <>
                  {" "}· next <DueLabel iso={g.items.filter((q) => q.enabled).sort((a, b) => (a.nextDueAt ?? "").localeCompare(b.nextDueAt ?? ""))[0]?.nextDueAt ?? null} now={now} alive={pollerAlive} bare />
                </>
              ) : (
                " · not polled"
              )}
              <PowerSwitch
                on={g.enabled}
                busy={pending.has(`site:${g.key}`)}
                label={
                  g.enabled
                    ? `Pause polling ${RETAILER_NAMES[g.retailer] ?? g.retailer} ${g.country} (takes effect next cycle)`
                    : `Resume polling ${RETAILER_NAMES[g.retailer] ?? g.retailer} ${g.country}`
                }
                onToggle={() => void toggle(`site:${g.key}`, { retailer: g.retailer, country: g.country }, !g.enabled)}
              />
            </span>
          </div>
          {/* Disabled storefronts collapse to their header — nothing is
              scheduled, so there is nothing to show. */}
          {g.enabled && (
            <table className="ps-queue-table">
              <thead>
                <tr>
                  <th>Product · watch</th>
                  <th className="ps-mt-num" title="Poll interval for the product at this storefront (its search and every tracked URL). Below 1h runs in the fast poller.">Every</th>
                  <th className="ps-mt-status">Last poll</th>
                  <th className="ps-mt-num" title="Duration of the last poll · 24h median">Took</th>
                  <th className="ps-mt-num" title="Listings currently surfaced · in stock / out of stock. Click for product cards.">Found</th>
                  <th className="ps-mt-status">Next</th>
                </tr>
              </thead>
              {g.products.map((pg) => {
                const own = pg.search ? listingsByWatch.get(pg.search.watchId) ?? [] : [];
                const viaUrls = getViaUrls(pg.urls, listingsByWatch, pg.productName);
                const open = () => onDetail(pg.anchor.watchId);
                return (
                  <tbody key={pg.key} className={`ps-q-group ${pg.enabled ? "" : "ps-q-group-off"}`}>
                    <ProductRow
                      pg={pg}
                      now={now}
                      alive={pollerAlive}
                      own={own}
                      viaUrls={viaUrls}
                      onOpen={open}
                      intervalBusy={pending.has(`interval:${pg.key}`)}
                      onInterval={(sec) =>
                        void patch(`interval:${pg.key}`, { retailer: pg.retailer, country: pg.country, productId: pg.productId }, { pollIntervalSec: sec })
                      }
                    />
                  </tbody>
                );
              })}
            </table>
          )}
        </div>
      ))}
      {detailGroup && (
        <WatchListingsModal
          pg={detailGroup}
          own={detailGroup.search ? listingsByWatch.get(detailGroup.search.watchId) ?? [] : []}
          viaUrls={getViaUrls(detailGroup.urls, listingsByWatch, detailGroup.productName)}
          now={now}
          onClose={() => onDetail(null)}
        />
      )}
    </div>
  );
}

/** One product at one storefront: its search watch (if any) plus the
 *  product-URL watches tracking that product there. `anchor` is the watch
 *  whose id addresses the group in the URL hash. */
interface ProductGroup {
  key: string;
  retailer: string;
  country: string;
  productId: string;
  productName: string;
  search: WatchQueueItem | null;
  urls: WatchQueueItem[];
  items: WatchQueueItem[];
  anchor: WatchQueueItem;
  enabled: boolean;
  nextDue: number;
  /** Common configured interval across the group's watches; null when mixed. */
  intervalSec: number | null;
}

/** Interval choices for the per-product "Every" control. */
const INTERVAL_CHOICES = [60, 120, 300, 600, 900, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86_400];

function shortProductName(name: string): string {
  return name.replace("NVIDIA GeForce ", "");
}

/** The product row: the search watch's numbers (or, when a product is only
 *  tracked by URL, a rollup of its URL watches), the group's interval
 *  control, and the combined Found count that opens the card modal. */
function ProductRow({
  pg,
  now,
  alive,
  own,
  viaUrls,
  onOpen,
  intervalBusy,
  onInterval,
}: {
  pg: ProductGroup;
  now: number | null;
  alive: boolean;
  own: WatchListing[];
  viaUrls: WatchListing[];
  onOpen: () => void;
  intervalBusy: boolean;
  onInterval: (sec: number) => void;
}) {
  const s = pg.search;
  const urlsOn = pg.urls.filter((q) => q.enabled);
  // Numbers shown on the row: the search watch's own when it exists,
  // otherwise a rollup across the URL watches.
  const lastPollAt = s ? s.lastPollAt : urlsOn.map((q) => q.lastPollAt).filter(Boolean).sort().at(-1) ?? null;
  const urlsStatus: WatchQueueItem["lastStatus"] =
    urlsOn.some((q) => q.lastStatus === "error" || q.lastStatus === "rate_limited")
      ? "error"
      : urlsOn.some((q) => q.lastStatus === "ok")
        ? "ok"
        : urlsOn.some((q) => q.lastStatus === "empty")
          ? "empty"
          : null;
  // If the search watch succeeded with "empty" (e.g. all listings owned by URL watches),
  // but URL watches exist and are "ok", reflect "ok" rather than "empty".
  const lastStatus: WatchQueueItem["lastStatus"] =
    s && s.lastStatus === "empty" && urlsStatus === "ok"
      ? "ok"
      : s
        ? s.lastStatus
        : urlsStatus;
  const durs = urlsOn.map((q) => q.lastDurationMs).filter((d): d is number => d != null);
  const lastDurationMs = s ? s.lastDurationMs : durs.length ? Math.max(...durs) : null;
  const p50DurationMs = s ? s.p50DurationMs : null;
  const nextDueAt = s?.enabled
    ? s.nextDueAt
    : urlsOn.map((q) => q.nextDueAt).filter((d): d is string => d != null).sort()[0] ?? null;
  const lastError = s?.lastError ?? urlsOn.find((q) => q.lastError)?.lastError ?? null;
  const effective = s ? s.effectiveIntervalSec : urlsOn[0]?.effectiveIntervalSec ?? pg.urls[0]?.effectiveIntervalSec ?? null;

  const total = own.length + viaUrls.length;
  const counts = stockCounts([...own, ...viaUrls]);
  // An "empty" search result is not actively "fetching" — it's a finished poll.
  // Show "unknown" (neutral amber) for empty when no listings exist, or "in" if items exist.
  const tone =
    lastStatus === "ok"
      ? "in"
      : lastStatus === "empty"
        ? (total > 0 ? "in" : "unknown")
        : lastStatus == null
          ? "unknown"
          : "out";
  const statusLabel = lastStatus == null ? "never" : lastStatus === "rate_limited" ? "429" : lastStatus === "error" ? "error" : lastStatus;
  const name = shortProductName(pg.productName);
  const query = s?.query ?? null;
  const showQuery = query != null && query.trim().toLowerCase() !== name.trim().toLowerCase();

  const choices = [...INTERVAL_CHOICES];
  if (pg.intervalSec != null && !choices.includes(pg.intervalSec)) choices.push(pg.intervalSec);
  choices.sort((a, b) => a - b);
  const options = choices.map((sec) => ({ value: String(sec), label: fmtDur(sec) }));
  if (pg.intervalSec == null) options.unshift({ value: "mixed", label: "mixed" });
  const intervalValue = pg.intervalSec == null ? "mixed" : String(pg.intervalSec);

  return (
    <tr className={`ps-q-prod ${!pg.enabled ? "ps-q-off" : lastStatus === "error" || lastStatus === "rate_limited" ? "ps-q-bad" : ""}`}>
      <td className="ps-q-watch">
        <span className="ps-q-cell">
          <span className={`light ${tone}`} />
          <button
            type="button"
            className="ps-q-prodname"
            onClick={onOpen}
            disabled={total === 0 && pg.urls.length === 0 && !s}
            title="Show product cards in modal"
          >
            {name}
          </button>
          {showQuery && <span className="ps-q-product" title="Search query">“{query}”</span>}
          {pg.urls.length > 0 && (
            <button
              type="button"
              className="ps-q-urlcount"
              onClick={onOpen}
              title={`${pg.urls.length} tracked product links — click to open modal`}
            >
              {pg.urls.length} URL{pg.urls.length === 1 ? "" : "s"}
            </button>
          )}
          {!s && <span className="ps-q-product">URL-only</span>}
        </span>
        {lastError && <span className="ps-q-err">{lastError}</span>}
      </td>
      <td className="ps-mt-num ps-q-every">
        <span className={`ps-q-interval ${intervalBusy ? "busy" : ""}`} title="Set how often this product is polled at this storefront (search + tracked URLs)">
          <Dropdown
            value={intervalValue}
            onValueChange={(v) => {
              const sec = Number(v);
              if (Number.isFinite(sec) && sec > 0 && sec !== pg.intervalSec) onInterval(sec);
            }}
            options={options}
            ariaLabel={`Poll interval for ${name} at ${RETAILER_NAMES[pg.retailer] ?? pg.retailer} ${pg.country}`}
          />
        </span>
        {effective != null && pg.intervalSec != null && effective !== pg.intervalSec && (
          <span className="ps-mt-sub" title={`Configured ${fmtDur(pg.intervalSec)}; the hourly cron rounds it up`}>runs {fmtDur(effective)}</span>
        )}
      </td>
      <td className="ps-mt-status" title={lastError ?? (lastDurationMs != null ? `${lastDurationMs}ms` : "")}>
        <span className={`ps-mt-last ${tone}`}>{statusLabel}</span>
        <span className="ps-mt-ago">{lastPollAt ? relTime(lastPollAt, now) : "—"}</span>
      </td>
      <td className="ps-mt-num" title={s?.p50DurationMs != null ? `24h median ${fmtMs(s.p50DurationMs)} over ${s.polls24h} polls` : undefined}>
        {lastDurationMs != null ? <span className={`ps-dur ${durTone(lastDurationMs)}`}>{fmtMs(lastDurationMs)}</span> : "—"}
        {p50DurationMs != null && <span className="ps-mt-sub">typ {fmtMs(p50DurationMs)}</span>}
      </td>
      <td className="ps-mt-num ps-q-found-cell">
        <FoundButton
          total={total}
          own={own.length}
          via={viaUrls.length}
          counts={counts}
          onOpen={onOpen}
          label={name}
          hint={s?.lastListings != null ? `${s.lastListings} returned, ${s.lastRouted ?? 0} routed on last poll` : ""}
        />
      </td>
      <td className="ps-mt-status">
        <DueLabel iso={nextDueAt} now={now} alive={alive} />
      </td>
    </tr>
  );
}

function FoundButton({
  total,
  own,
  via,
  counts,
  onOpen,
  label,
  hint,
}: {
  total: number;
  own: number;
  via: number;
  counts: { inStock: number; out: number; unknown: number };
  onOpen: () => void;
  label: string;
  hint?: string;
}) {
  const openable = total > 0;
  return (
    <button
      type="button"
      className={`ps-q-found ${openable ? "" : "empty"}`}
      disabled={!openable}
      onClick={onOpen}
      title={(openable ? "Show product cards. " : "") + (hint ?? "")}
      aria-label={openable ? `Show ${total} listings for ${label}` : undefined}
    >
      <span className="ps-q-found-n">
        {own}
        {via > 0 && (
          <span className="ps-q-found-via" title={`${via} tracked by product-URL watches`}>
            +{via}
          </span>
        )}
      </span>
      {total > 0 && (
        <span className="ps-q-found-split">
          <span className={counts.inStock > 0 ? "in" : "dim"}>{counts.inStock} in</span>
          <span className={counts.out > 0 ? "out" : "dim"}>{counts.out} out</span>
        </span>
      )}
    </button>
  );
}

/** Synthesize listing objects for product-URL watches: either the real
 *  listing polled and saved in `listingsByWatch`, or a fallback card
 *  pointing directly at the product page so it is always clickable and
 *  inspectable in the modal. */
function getViaUrls(
  urls: WatchQueueItem[],
  listingsByWatch: Map<string, WatchListing[]>,
  productName: string,
): WatchListing[] {
  return urls.flatMap((u) => {
    const list = listingsByWatch.get(u.watchId);
    if (list && list.length > 0) return list;
    let title = u.query;
    try {
      title = decodeURIComponent(new URL(u.query).pathname.replace(/^\//, ""));
    } catch {
      /* keep raw */
    }
    return [
      {
        w: {
          watchId: u.watchId,
          retailer: u.retailer,
          country: u.country,
          category: "gpu" as const,
          query: u.query,
          pollIntervalSec: u.pollIntervalSec,
          inStock: false,
          status: (u.lastStatus === "ok" ? "in_stock" : u.lastStatus === "empty" ? "out_of_stock" : "unknown") as WatchView["status"],
          price: null,
          originalPrice: null,
          discountAmount: null,
          title,
          url: u.query,
          seller: RETAILER_NAMES[u.retailer] ?? u.retailer,
          mpn: null,
          imageUrl: null,
          updatedAt: u.lastPollAt,
          currency: "USD",
        },
        productImage: null,
        productName,
      },
    ];
  });
}

/** One listing as surfaced on the Overview, with the product it rolled up to. */
interface WatchListing {
  w: WatchView;
  productImage: string | null;
  productName: string;
}

function fmtListingPrice(w: WatchView): string | null {
  if (w.price == null || w.price === "") return null;
  return `${currencySymbol(w.currency)}${Number(w.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function stockCounts(list: WatchListing[]): { inStock: number; out: number; unknown: number } {
  let inStock = 0;
  let out = 0;
  let unknown = 0;
  for (const l of list) {
    if (l.w.status === "in_stock") inStock++;
    else if (l.w.status === "out_of_stock") out++;
    else unknown++;
  }
  return { inStock, out, unknown };
}

/** In-stock first, then cards before accessories/laptops, then cheapest,
 *  then by title — the order an admin scans. */
function sortListings(list: WatchListing[]): WatchListing[] {
  const rank = (s: WatchView["status"]) => (s === "in_stock" ? 0 : s === "out_of_stock" ? 2 : 1);
  const catRank = (c: WatchView["category"]) => (c === "gpu" ? 0 : c === "desktop" ? 1 : 2);
  return [...list].sort((a, b) => {
    const r = rank(a.w.status) - rank(b.w.status) || catRank(a.w.category) - catRank(b.w.category);
    if (r) return r;
    const pa = a.w.price != null && a.w.price !== "" ? Number(a.w.price) : Infinity;
    const pb = b.w.price != null && b.w.price !== "" ? Number(b.w.price) : Infinity;
    if (pa !== pb) return pa - pb;
    return (a.w.title ?? "").localeCompare(b.w.title ?? "");
  });
}

/**
 * Detail layer for one product at one storefront: every listing its search
 * watch currently surfaces plus the product-URL watches tracking it there, as
 * cards (image, name, status, price). Rendered through a portal onto
 * `document.body` so it sits above the whole app regardless of which panel
 * opened it (panels use `backdrop-filter`, which would otherwise trap a
 * `position: fixed` overlay inside them), and addressed by the URL hash so a
 * link to it can be shared or reopened.
 */
function WatchListingsModal({
  pg,
  own,
  viaUrls,
  now,
  onClose,
}: {
  pg: ProductGroup;
  own: WatchListing[];
  viaUrls: WatchListing[];
  now: number | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock page scroll behind the layer.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const all = [...own, ...viaUrls];
  const c = stockCounts(all);
  const name = shortProductName(pg.productName);
  const s = pg.search;
  const lastPollAt = s?.lastPollAt ?? pg.urls.map((q) => q.lastPollAt).filter(Boolean).sort().at(-1) ?? null;
  const sections: { key: string; title: string | null; list: WatchListing[] }[] = [];
  if (own.length || !viaUrls.length) {
    sections.push({ key: "own", title: viaUrls.length ? `Found by search “${s?.query ?? name}” · ${own.length}` : null, list: sortListings(own) });
  }
  if (viaUrls.length) {
    sections.push({
      key: "urls",
      title: own.length ? `Tracked product pages · ${viaUrls.length}` : null,
      list: sortListings(viaUrls),
    });
  }

  if (!mounted) return null;
  return createPortal(
    <div className="modal-overlay wl-overlay" onClick={onClose}>
      <div className="modal wl-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Listings for ${name} at ${RETAILER_NAMES[pg.retailer] ?? pg.retailer} ${pg.country}`}>
        <div className="modal-head">
          <div className="wl-head">
            <span className="badges">
              <span className={`badge ret-${pg.retailer}`}>{RETAILER_NAMES[pg.retailer] ?? pg.retailer}</span>
              <span className={`badge c-${pg.country}`} title={COUNTRY_NAMES[pg.country] ?? pg.country}>
                <span className="flag">{COUNTRY_FLAGS[pg.country] ?? ""}</span>
                {pg.country}
              </span>
              {pg.intervalSec != null && <span className="ps-q-kind">every {fmtDur(pg.intervalSec)}</span>}
            </span>
            <h2>{name}</h2>
            <div className="mpn">
              {[
                s && s.query.trim().toLowerCase() !== name.trim().toLowerCase() ? `search “${s.query}”` : null,
                pg.urls.length ? `${pg.urls.length} tracked page${pg.urls.length === 1 ? "" : "s"}` : null,
                lastPollAt ? `polled ${relTime(lastPollAt, now)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <span className="wl-actions">
            <button
              type="button"
              className="wl-copy"
              title="Copy link to this view"
              onClick={() => void navigator.clipboard?.writeText(window.location.href)}
            >
              Copy link
            </button>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </span>
        </div>
        <div className="modal-summary wl-summary">
          <span>{all.length} {all.length === 1 ? "listing" : "listings"}</span>
          <span className="wl-sum in"><span className="light in" />{c.inStock} in stock</span>
          <span className="wl-sum out"><span className="light out" />{c.out} out of stock</span>
          {c.unknown > 0 && <span className="wl-sum unknown"><span className="light unknown" />{c.unknown} unknown</span>}
        </div>
        <div className="modal-body wl-body">
          {all.length === 0 && (
            <div className="ps-metrics-empty">
              {s?.lastStatus === "empty" ? "The last poll returned no listings." : "No listings surfaced yet — they appear after the next poll."}
            </div>
          )}
          {sections.map((sec) => (
            <section key={sec.key} className="wl-section">
              {sec.title && <h3 className="wl-section-head">{sec.title}</h3>}
              <div className="wl-grid">
                {sec.list.map((l) => (
                  <ListingCard key={l.w.watchId} l={l} now={now} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ListingCard({ l, now }: { l: WatchListing; now: number | null }) {
  const { w } = l;
  const img = w.imageUrl ?? l.productImage;
  const cls = w.status === "in_stock" ? "in" : w.status === "out_of_stock" ? "out" : "unknown";
  const price = fmtListingPrice(w);
  const was =
    w.originalPrice != null && w.originalPrice !== "" && Number(w.originalPrice) > Number(w.price ?? 0)
      ? `${currencySymbol(w.currency)}${Number(w.originalPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null;
  const title = w.title || l.productName;
  return (
    <article className={`wl-card ${cls}`}>
      <div className="wl-img">
        {img ? <ThumbImg src={`/api/img?u=${encodeURIComponent(img)}`} alt="" /> : null}
      </div>
      <div className="wl-main">
        {w.url ? (
          <a className="wl-title" href={w.url} target="_blank" rel="noreferrer" title={title}>
            {title}
          </a>
        ) : (
          <span className="wl-title" title={title}>{title}</span>
        )}
        <div className="wl-meta">
          <ConditionBadge condition={w.condition} />
          {w.mpn && <span title="MPN">{w.mpn}</span>}
          {w.seller && <span title="Seller">{w.seller}</span>}
          {w.category !== "gpu" && <span className="wl-cat">{w.category}</span>}
        </div>
        <div className="wl-foot">
          <span className={`ps-q-stock ${cls}`}>
            <span className={`light ${cls}`} />
            {w.status === "in_stock" ? "In stock" : w.status === "out_of_stock" ? "Out of stock" : "Unknown"}
          </span>
          <span className="wl-price">
            {price ? (
              <>
                <strong className={cls === "in" ? "" : "wl-price-dim"}>{price}</strong>
                {was && <span className="wl-was">{was}</span>}
              </>
            ) : (
              <span className="wl-price-none">no price</span>
            )}
          </span>
        </div>
        {w.updatedAt && <div className="wl-updated">changed {relTime(w.updatedAt, now)}</div>}
      </div>
    </article>
  );
}

/** "in 4m" / "due now" / "overdue 12m" from a next-due timestamp. A watch
 *  that's past due by more than ~1.5× a minute is flagged overdue (GitHub
 *  Actions' cron drifts, so a few minutes late is normal and shows as queued). */
function DueLabel({ iso, now, alive, bare }: { iso: string | null; now: number | null; alive: boolean; bare?: boolean }) {
  if (!iso || now == null) return <span className={bare ? "" : "ps-q-due unknown"}>—</span>;
  const sec = Math.round((new Date(iso).getTime() - now) / 1000);
  let text: string;
  let tone: "ok" | "due" | "late";
  if (sec > 0) {
    text = `in ${fmtDur(sec)}`;
    tone = "ok";
  } else if (sec > -900) {
    text = alive ? "queued" : "due";
    tone = "due";
  } else {
    text = `overdue ${fmtDur(-sec)}`;
    tone = "late";
  }
  return <span className={bare ? `ps-q-due-inline ${tone}` : `ps-q-due ${tone}`}>{text}</span>;
}

/** Poll duration: "840ms" / "3.2s" / "1m 12s". */
function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Colour band for a poll duration: ≤5s fine, ≤20s slow, beyond that bad. */
function durTone(ms: number): "ok" | "warn" | "bad" {
  if (ms <= 5_000) return "ok";
  if (ms <= 20_000) return "warn";
  return "bad";
}

function fmtDur(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(sec / 3600)}h`;
}

/** Per-(retailer, country) performance analytics: latency (p50/p95), success
 *  rate, and listing yield over the last 24h — the "how well is the tracking
 *  service doing" panel. Surfaces flaky pipelines (low success rate / high
 *  p95) and the overall roll-up so you can see at a glance which storefronts
 *  are healthy and which need attention. */
function MetricsPanel({ metrics }: { metrics: PollMetrics }) {
  if (metrics.totalPolls === 0 && metrics.rows.length === 0) {
    return (
      <div className="ps-metrics">
        <div className="ps-coverage-head">
          <span className="ps-coverage-title">Performance (24h)</span>
          <span className="ps-metrics-empty">No polls recorded yet</span>
        </div>
      </div>
    );
  }

  const overallPct = Math.round(metrics.overallSuccessRate * 100);
  const overallTone =
    overallPct >= 90 ? "ok" : overallPct >= 50 ? "warn" : "bad";

  return (
    <div className="ps-metrics">
      <div className="ps-coverage-head">
        <span className="ps-coverage-title">Performance (last 24h)</span>
        <span className="ps-metrics-summary">
          <span className={`ps-metrics-rate ${overallTone}`}>{overallPct}%</span> success ·
          <span className="ps-metrics-lat"> p50 {fmtMs(metrics.overallP50Ms)}</span> ·
          <span className="ps-metrics-lat"> p95 {fmtMs(metrics.overallP95Ms)}</span> ·
          <span className="ps-metrics-lat"> {metrics.totalPolls} polls</span>
        </span>
      </div>
      <table className="ps-metrics-table">
        <thead>
          <tr>
            <th className="ps-mt-retailer">Pipeline</th>
            <th className="ps-mt-num">Polls</th>
            <th className="ps-mt-num">Success</th>
            <th className="ps-mt-num">p50</th>
            <th className="ps-mt-num">p95</th>
            <th className="ps-mt-num">Avg listings</th>
            <th className="ps-mt-status">Last</th>
          </tr>
        </thead>
        <tbody>
          {metrics.rows.map((r) => (
            <MetricRowView key={`${r.retailer}|${r.country}`} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricRowView({ row }: { row: MetricRow }) {
  const pct = Math.round(row.successRate * 100);
  const tone = pct >= 90 ? "ok" : pct >= 50 ? "warn" : "bad";
  const lastTone =
    row.lastStatus === "ok"
      ? "in"
      : row.lastStatus === "empty"
        ? "unknown"
        : row.lastStatus === "rate_limited" || row.lastStatus === "error"
          ? "out"
          : "unknown";
  const lastLabel =
    row.lastStatus === null
      ? "—"
      : row.lastStatus === "ok"
        ? "ok"
        : row.lastStatus === "empty"
          ? "empty"
          : row.lastStatus === "rate_limited"
            ? "429"
            : "err";
  return (
    <tr>
      <td className="ps-mt-retailer">
        <span className={`light ${lastTone}`} />
        <span className="badges">
          <span className={`badge ret-${row.retailer}`}>{RETAILER_NAMES[row.retailer] ?? row.retailer}</span>
          <span className={`badge c-${row.country}`} title={COUNTRY_NAMES[row.country] ?? row.country}>
            <span className="flag">{COUNTRY_FLAGS[row.country] ?? ""}</span>
            {row.country}
          </span>
        </span>
      </td>
      <td className="ps-mt-num">{row.polls}</td>
      <td className={`ps-mt-num ps-mt-rate ${tone}`}>
        {pct}%
        <span className="ps-mt-sub">
          {row.ok}/{row.polls}
        </span>
      </td>
      <td className="ps-mt-num">
        <span className={`ps-dur ${durTone(row.p50Ms)}`}>{fmtMs(row.p50Ms)}</span>
      </td>
      <td className="ps-mt-num">
        <span className={`ps-dur ${durTone(row.p95Ms)}`}>{fmtMs(row.p95Ms)}</span>
      </td>
      <td className="ps-mt-num">
        {row.avgListings}
        <span className="ps-mt-sub">Σ {row.totalListings}</span>
      </td>
      <td className="ps-mt-status" title={row.lastError ?? ""}>
        <span className={`ps-mt-last ${lastTone}`}>{lastLabel}</span>
        <span className="ps-mt-ago">{ago(row.lastPollAt)}</span>
      </td>
    </tr>
  );
}

function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// --- Catalog page -----------------------------------------------------------

const CATALOG_TYPE_LABELS: Record<CatalogType, string> = {
  gpu: "GPU",
  desktop: "Desktop PC",
  laptop: "Laptop",
  accessory: "Accessory",
  other: "Other",
};
const CATALOG_TYPE_ORDER: readonly CatalogType[] = ["gpu", "desktop", "laptop", "accessory", "other"];
const CATALOG_ID_LABELS: Record<CatalogIdKind, string> = {
  asin: "ASIN",
  item: "Item #",
  sku: "SKU",
  ref: "Ref",
  url: "URL",
};

/** Provenance chip for a part number the retailer did not report itself. */
const MPN_SOURCE_LABELS: Record<MpnSource, { chip: string; title: string } | null> = {
  retailer: null,
  title: { chip: "title", title: "Part number printed in the retailer's listing title" },
  product: { chip: "sibling", title: "Inherited from another retailer's listing of the same product" },
  pattern: { chip: "inferred", title: "Derived from the maker's part-number naming scheme" },
  catalog: { chip: "catalog", title: "Looked up in the verified part-number table" },
};

function CatalogMpn({ mpn, source }: { mpn: string | null; source: MpnSource | null }) {
  if (!mpn) return <span className="muted">—</span>;
  const tag = source ? MPN_SOURCE_LABELS[source] : null;
  return (
    <>
      {mpn}
      {tag && (
        <span className={`catalog-mpn-src src-${source}`} title={tag.title}>
          {tag.chip}
        </span>
      )}
    </>
  );
}

type CatalogMode = "products" | "items";
type CatalogSort = "model" | "name" | "maker" | "price-asc" | "price-desc" | "offers" | "retailers";

/**
 * Catalog page. Two levels:
 *  - Products: the real-world item (e.g. "ASUS ROG Astral RTX 5090 OC"),
 *    grouping every retailer's catalog entry for it, with cross-retailer
 *    price / availability comparison.
 *  - Catalog items: the lowest level — one row per retailer product id
 *    (ASIN, Newegg item #, Best Buy SKU…). Identity only; prices live on
 *    the offers underneath.
 */
function CatalogPage({ products }: { products: CatalogProduct[] }) {
  const [mode, setMode] = useState<CatalogMode>("products");
  const [type, setType] = useState<"all" | CatalogType>("all");
  const [model, setModel] = useState("all");
  const [maker, setMaker] = useState("all");
  const [retailer, setRetailer] = useState("all");
  const [sort, setSort] = useState<CatalogSort>("model");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const allItems = useMemo(() => products.flatMap((p) => p.items), [products]);
  const productByKey = useMemo(() => new Map(products.map((p) => [p.key, p])), [products]);

  const types = useMemo(
    () => CATALOG_TYPE_ORDER.filter((t) => products.some((p) => p.type === t)),
    [products],
  );
  const models = useMemo(
    () => [...new Set(products.map((p) => p.model).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [products],
  );
  const makers = useMemo(
    () => [...new Set(products.map((p) => p.maker).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [products],
  );
  const retailers = useMemo(
    () => [...new Set(allItems.map((i) => i.retailer))].sort(),
    [allItems],
  );

  const needle = q.trim().toLowerCase();
  const words = needle.split(/\s+/).filter(Boolean);
  const matchesAll = (hay: string) => words.every((w) => hay.includes(w));
  const itemMatches = (i: CatalogItem) => {
    if (retailer !== "all" && i.retailer !== retailer) return false;
    if (!needle) return true;
    const hay = [i.name, i.maker, i.model, i.id, i.mpn ?? "", ...i.offers.map((o) => o.listingId)].join(" ").toLowerCase();
    return matchesAll(hay);
  };

  const filteredProducts = useMemo(() => {
    const rows = products.filter((p) => {
      if (type !== "all" && p.type !== type) return false;
      if (model !== "all" && p.model !== model) return false;
      if (maker !== "all" && p.maker !== maker) return false;
      if (retailer === "all" && !needle) return true;
      // Retailer / search filters apply at the item level: a product shows
      // when any of its catalog items match.
      const hayP = [p.name, p.maker, p.model, ...p.mpns].join(" ").toLowerCase();
      if (retailer === "all" && matchesAll(hayP)) return true;
      return p.items.some(itemMatches);
    });
    const price = (p: CatalogProduct) => (p.minUsd == null ? Infinity : p.minUsd);
    switch (sort) {
      case "name":
        rows.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "maker":
        rows.sort((a, b) => (a.maker || "~").localeCompare(b.maker || "~") || a.name.localeCompare(b.name));
        break;
      case "price-asc":
        rows.sort((a, b) => price(a) - price(b) || a.name.localeCompare(b.name));
        break;
      case "price-desc":
        rows.sort((a, b) => (price(b) === Infinity ? -1 : price(a) === Infinity ? 1 : price(b) - price(a)) || a.name.localeCompare(b.name));
        break;
      case "offers":
        rows.sort((a, b) => b.offers - a.offers || a.name.localeCompare(b.name));
        break;
      case "retailers":
        rows.sort((a, b) => b.retailers.length - a.retailers.length || b.offers - a.offers || a.name.localeCompare(b.name));
        break;
      default:
        break; // catalog order: model → type → maker → name
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, type, model, maker, retailer, sort, needle]);

  const filteredItems = useMemo(() => {
    const rows = allItems.filter((i) => {
      if (type !== "all" && i.type !== type) return false;
      if (model !== "all" && i.model !== model) return false;
      if (maker !== "all" && i.maker !== maker) return false;
      return itemMatches(i);
    });
    switch (sort) {
      case "name":
        rows.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "maker":
        rows.sort((a, b) => (a.maker || "~").localeCompare(b.maker || "~") || a.name.localeCompare(b.name));
        break;
      case "offers":
        rows.sort((a, b) => b.offers.length - a.offers.length || a.name.localeCompare(b.name));
        break;
      case "retailers":
        rows.sort((a, b) => a.retailer.localeCompare(b.retailer) || a.name.localeCompare(b.name));
        break;
      case "price-asc":
      case "price-desc":
      default:
        rows.sort(
          (a, b) =>
            a.model.localeCompare(b.model, undefined, { numeric: true }) ||
            a.type.localeCompare(b.type) ||
            a.maker.localeCompare(b.maker) ||
            a.name.localeCompare(b.name) ||
            a.retailer.localeCompare(b.retailer),
        );
        break;
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, type, model, maker, retailer, sort, needle]);

  const stats = useMemo(() => {
    const items = filteredProducts.flatMap((p) => p.items);
    const offers = items.reduce((n, i) => n + i.offers.length, 0);
    const inStock = filteredProducts.filter((p) => p.inStock > 0).length;
    const multi = filteredProducts.filter((p) => p.retailers.length > 1).length;
    return { products: filteredProducts.length, items: items.length, offers, inStock, multi };
  }, [filteredProducts]);

  return (
    <div className="catalog">
      <div className="stats">
        <div className="stat">
          <div className="n">{stats.products}</div>
          <div className="l">Products</div>
        </div>
        <div className="stat">
          <div className="n">{stats.items}</div>
          <div className="l">Catalog items</div>
        </div>
        <div className="stat">
          <div className="n">{stats.multi}</div>
          <div className="l">Sold at 2+ retailers</div>
        </div>
        <div className="stat green">
          <div className="n">{stats.inStock}</div>
          <div className="l">In stock somewhere</div>
        </div>
        <div className="stat">
          <div className="n">{stats.offers}</div>
          <div className="l">Offers</div>
        </div>
      </div>

      <div className="filters">
        <div className="filter-group">
          <div className="seg" role="tablist" aria-label="Catalog level">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "products"}
              className={`seg-btn ${mode === "products" ? "active" : ""}`}
              onClick={() => { setMode("products"); setOpen(null); }}
            >
              Products <span className="seg-n">{filteredProducts.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "items"}
              className={`seg-btn ${mode === "items" ? "active" : ""}`}
              onClick={() => { setMode("items"); setOpen(null); }}
            >
              Catalog items <span className="seg-n">{filteredItems.length}</span>
            </button>
          </div>
          <Dropdown
            ariaLabel="Product type"
            value={type}
            onValueChange={(v) => setType(v as "all" | CatalogType)}
            options={[
              { value: "all", label: "All types" },
              ...types.map((t) => ({ value: t, label: CATALOG_TYPE_LABELS[t] })),
            ]}
          />
          <Dropdown
            ariaLabel="Model"
            value={model}
            onValueChange={setModel}
            options={[{ value: "all", label: "All models" }, ...models.map((m) => ({ value: m, label: m }))]}
          />
          <Dropdown
            ariaLabel="Maker"
            value={maker}
            onValueChange={setMaker}
            options={[{ value: "all", label: "All makers" }, ...makers.map((m) => ({ value: m, label: m }))]}
          />
          <Dropdown
            ariaLabel="Retailer"
            value={retailer}
            onValueChange={setRetailer}
            options={[{ value: "all", label: "All retailers" }, ...retailers.map((r) => ({ value: r, label: RETAILER_NAMES[r] ?? r }))]}
          />
          <Dropdown
            ariaLabel="Sort"
            value={sort}
            onValueChange={(v) => setSort(v as CatalogSort)}
            options={
              mode === "products"
                ? [
                    { value: "model", label: "Model" },
                    { value: "name", label: "Name: A–Z" },
                    { value: "maker", label: "Maker: A–Z" },
                    { value: "price-asc", label: "Lowest price: low to high" },
                    { value: "price-desc", label: "Lowest price: high to low" },
                    { value: "retailers", label: "Most retailers" },
                    { value: "offers", label: "Most offers" },
                  ]
                : [
                    { value: "model", label: "Model" },
                    { value: "name", label: "Name: A–Z" },
                    { value: "maker", label: "Maker: A–Z" },
                    { value: "retailers", label: "Retailer" },
                    { value: "offers", label: "Most offers" },
                  ]
            }
          />
        </div>
        <input
          className="filter-search"
          placeholder="Search name, part number, ASIN / SKU…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {mode === "products" ? (
        filteredProducts.length === 0 ? (
          <div className="empty">No products match these filters.</div>
        ) : (
          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th className="cat-col-item">Product</th>
                  <th className="cat-col-left">Maker</th>
                  <th className="cat-col-left">Model</th>
                  <th className="cat-col-left">Type</th>
                  <th className="cat-col-left">Part number</th>
                  <th className="cat-col-left">Sold at</th>
                  <th>Offers</th>
                  <th>Lowest</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => (
                  <CatalogProductRow
                    key={p.key}
                    product={p}
                    open={open === p.key}
                    onToggle={() => setOpen(open === p.key ? null : p.key)}
                    highlightRetailer={retailer === "all" ? null : retailer}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filteredItems.length === 0 ? (
        <div className="empty">No catalog items match these filters.</div>
      ) : (
        <div className="catalog-table-wrap">
          <table className="catalog-table">
            <thead>
              <tr>
                <th className="cat-col-left">Retailer</th>
                <th className="cat-col-left">Identifier</th>
                <th className="cat-col-item">Catalog item</th>
                <th className="cat-col-left">Maker</th>
                <th className="cat-col-left">Model</th>
                <th className="cat-col-left">Type</th>
                <th className="cat-col-left">Part number</th>
                <th className="cat-col-left">Product</th>
                <th>Offers</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((i) => (
                <CatalogItemRow
                  key={i.key}
                  item={i}
                  product={productByKey.get(i.productKey)}
                  open={open === i.key}
                  onToggle={() => setOpen(open === i.key ? null : i.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CatalogThumb({ src }: { src: string | null }) {
  return (
    <span className="catalog-thumb">
      <span className="rowthumb ph" aria-hidden>▣</span>
      {src && <ThumbImg src={`/api/img?u=${encodeURIComponent(src)}`} />}
    </span>
  );
}

function CatalogStockSummary({ inStock, offers }: { inStock: number; offers: number }) {
  return (
    <>
      <span className={`light ${inStock > 0 ? "in" : "out"}`} />
      {inStock > 0 ? `${inStock} of ${offers} in stock` : `out of stock (${offers})`}
    </>
  );
}

function CatalogProductRow({
  product: p,
  open,
  onToggle,
  highlightRetailer,
}: {
  product: CatalogProduct;
  open: boolean;
  onToggle: () => void;
  highlightRetailer: string | null;
}) {
  const nonNew = p.conditions.filter((c) => c !== "new");
  return (
    <>
      <tr className={`catalog-row ${open ? "open" : ""} ${p.inStock > 0 ? "" : "catalog-row-out"}`} onClick={onToggle}>
        <td className="cat-col-item">
          <div className="catalog-item">
            <CatalogThumb src={p.imageUrl} />
            <div className="catalog-item-text">
              <div className="catalog-name" title={p.name}>{p.name}</div>
              <div className="catalog-sub">
                <CatalogStockSummary inStock={p.inStock} offers={p.offers} />
                {nonNew.length > 0 && (
                  <>
                    {" · "}
                    {nonNew.map((c) => (
                      <ConditionBadge key={c} condition={c} />
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </td>
        <td className="cat-col-left">{p.maker || <span className="muted">—</span>}</td>
        <td className="cat-col-left"><span className="catalog-model">{p.model || "—"}</span></td>
        <td className="cat-col-left">
          <span className={`badge cat-${p.type}`}>{CATALOG_TYPE_LABELS[p.type]}</span>
        </td>
        <td className="cat-col-left catalog-pn" title={p.mpns.join(", ")}>
          <CatalogMpn
            mpn={p.mpns[0] ?? null}
            // Only flag the product when no retailer reported the number.
            source={p.items.some((i) => i.mpnSource === "retailer" || i.mpnSource === "title") ? null : (p.items.find((i) => i.mpn)?.mpnSource ?? null)}
          />
          {p.mpns.length > 1 && <span className="muted"> +{p.mpns.length - 1}</span>}
        </td>
        <td className="cat-col-left">
          <div className="catalog-retailers">
            {p.retailers.map((r) => (
              <span key={r} className={`badge ret-${r} ${highlightRetailer && highlightRetailer !== r ? "dim" : ""}`}>
                {RETAILER_NAMES[r] ?? r}
              </span>
            ))}
          </div>
        </td>
        <td>
          {p.offers}
          <span className="muted catalog-items-n"> · {p.items.length} {p.items.length === 1 ? "item" : "items"}</span>
        </td>
        <td className="catalog-price">
          {p.minUsd == null ? (
            <span className="muted">—</span>
          ) : (
            <>
              ${fmtUsd(p.minUsd)}
              <div className="catalog-price-at muted">
                {RETAILER_NAMES[p.minUsdRetailer ?? ""] ?? p.minUsdRetailer} {COUNTRY_FLAGS[p.minUsdCountry ?? ""] ?? ""}
              </div>
            </>
          )}
        </td>
      </tr>
      {open && (
        <tr className="catalog-detail">
          <td colSpan={8}>
            <div className="catalog-detail-head">
              <span className="catalog-detail-label">Catalog items · {p.items.length}</span>
              <span className="muted">Tracked under {p.trackedProductName}</span>
            </div>
            <CatalogOffersTable items={p.items} bestUsd={p.minUsd} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The per-retailer comparison inside a product: one line per offer, grouped by catalog item. */
function CatalogOffersTable({ items, bestUsd }: { items: CatalogItem[]; bestUsd: number | null }) {
  return (
    <table className="catalog-offers">
      <thead>
        <tr>
          <th className="cat-col-left">Retailer</th>
          <th className="cat-col-left">Identifier</th>
          <th className="cat-col-left">Part number</th>
          <th className="cat-col-left">Listing</th>
          <th className="cat-col-left">Store</th>
          <th className="cat-col-left">Condition</th>
          <th className="cat-col-left">Stock</th>
          <th>Price</th>
          <th>USD</th>
          <th className="cat-col-left">Checked</th>
        </tr>
      </thead>
      <tbody>
        {items.flatMap((i) =>
          i.offers.map((o, idx) => (
            <tr key={`${i.key}-${o.listingId}-${o.country}-${idx}`} className={o.inStock ? "" : "catalog-offer-out"}>
              <td className="cat-col-left">
                {idx === 0 && <span className={`badge ret-${i.retailer}`}>{RETAILER_NAMES[i.retailer] ?? i.retailer}</span>}
              </td>
              <td className="cat-col-left catalog-pn">
                {idx === 0 && (
                  <>
                    <span className="catalog-id-kind">{CATALOG_ID_LABELS[i.idKind]}</span> {i.id}
                  </>
                )}
                {idx > 0 && o.listingId !== i.id && <span className="muted">{o.listingId}</span>}
                {idx === 0 && o.listingId !== i.id && <span className="muted"> ({o.listingId})</span>}
              </td>
              <td className="cat-col-left catalog-pn">{idx === 0 && <CatalogMpn mpn={i.mpn} source={i.mpnSource} />}</td>
              <td className="cat-col-left catalog-offer-title">
                <a href={o.url} target="_blank" rel="noreferrer" title={i.name} onClick={(e) => e.stopPropagation()}>
                  {i.name}
                </a>
              </td>
              <td className="cat-col-left">
                {COUNTRY_FLAGS[o.country] ?? ""} {o.country}
                {o.seller && o.seller !== (RETAILER_NAMES[o.retailer] ?? "") && (
                  <span className="muted"> · {o.seller}</span>
                )}
              </td>
              <td className="cat-col-left">{o.condition === "new" ? <span className="muted">New</span> : <ConditionBadge condition={o.condition} />}</td>
              <td className="cat-col-left">
                <span className={`light ${o.inStock ? "in" : o.status === "unknown" ? "unknown" : "out"}`} />{" "}
                {o.inStock ? "In stock" : o.status === "unknown" ? "Unknown" : "Out of stock"}
              </td>
              <td className="catalog-price">
                {o.price == null ? <span className="muted">—</span> : `${o.currency && o.currency !== "USD" ? `${o.currency} ` : "$"}${fmtUsd(o.price)}`}
              </td>
              <td className={`catalog-price ${o.inStock && bestUsd != null && o.usd != null && Math.abs(o.usd - bestUsd) < 0.005 ? "best" : ""}`}>
                {o.usd == null ? <span className="muted">—</span> : `$${fmtUsd(o.usd)}`}
              </td>
              <td className="cat-col-left muted">{o.updatedAt ? ago(o.updatedAt) : "—"}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

function CatalogItemRow({
  item: i,
  product,
  open,
  onToggle,
}: {
  item: CatalogItem;
  product: CatalogProduct | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={`catalog-row ${open ? "open" : ""} ${i.inStock > 0 ? "" : "catalog-row-out"}`} onClick={onToggle}>
        <td className="cat-col-left">
          <span className={`badge ret-${i.retailer}`}>{RETAILER_NAMES[i.retailer] ?? i.retailer}</span>
        </td>
        <td className="cat-col-left catalog-pn">
          <span className="catalog-id-kind">{CATALOG_ID_LABELS[i.idKind]}</span> {i.id}
        </td>
        <td className="cat-col-item">
          <div className="catalog-item">
            <CatalogThumb src={i.imageUrl} />
            <div className="catalog-item-text">
              <div className="catalog-name" title={i.name}>{i.name}</div>
              <div className="catalog-sub">
                <CatalogStockSummary inStock={i.inStock} offers={i.offers.length} />
              </div>
            </div>
          </div>
        </td>
        <td className="cat-col-left">{i.maker || <span className="muted">—</span>}</td>
        <td className="cat-col-left"><span className="catalog-model">{i.model || "—"}</span></td>
        <td className="cat-col-left">
          <span className={`badge cat-${i.type}`}>{CATALOG_TYPE_LABELS[i.type]}</span>
        </td>
        <td className="cat-col-left catalog-pn"><CatalogMpn mpn={i.mpn} source={i.mpnSource} /></td>
        <td className="cat-col-left catalog-product-ref" title={product?.name}>
          {product ? (
            <>
              {product.name}
              {product.items.length > 1 && (
                <span className="muted"> · {product.items.length} items</span>
              )}
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>{i.offers.length}</td>
      </tr>
      {open && (
        <tr className="catalog-detail">
          <td colSpan={9}>
            <div className="catalog-detail-head">
              <span className="catalog-detail-label">Offers · {i.offers.length}</span>
              <span className="muted">Tracked under {i.trackedProductName}</span>
            </div>
            <CatalogOffersTable items={[i]} bestUsd={product?.minUsd ?? null} />
          </td>
        </tr>
      )}
    </>
  );
}

function AddForm({ retailers }: { retailers: string[] }) {
  const [name, setName] = useState("");
  const [retailer, setRetailer] = useState(retailers[0] ?? "newegg");
  const [query, setQuery] = useState("");
  const [interval, setIntervalSec] = useState("300");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !query.trim()) return;
    await fetch("/api/watches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        retailer,
        query: query.trim(),
        pollIntervalSec: Number(interval) || 300,
      }),
    });
    setName("");
    setQuery("");
    location.reload();
  }

  return (
    <div className="add">
      <h2>Track a new product</h2>
      <p className="hint">Creates a product and a watch for one retailer. Add more watches per product later.</p>
      <form onSubmit={add}>
        <div className="field">
          <label>Product</label>
          <input placeholder="e.g. RTX 5090" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 150, flex: "0 0 auto" }}>
          <label>Retailer</label>
          <select value={retailer} onChange={(e) => setRetailer(e.target.value)}>
            {retailers.map((r) => (
              <option key={r} value={r}>
                {RETAILER_NAMES[r] ?? r}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Query</label>
          <input placeholder="search query" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 90, flex: "0 0 auto" }}>
          <label>Every (s)</label>
          <input value={interval} onChange={(e) => setIntervalSec(e.target.value)} />
        </div>
        <button type="submit">Track</button>
      </form>
    </div>
  );
}
