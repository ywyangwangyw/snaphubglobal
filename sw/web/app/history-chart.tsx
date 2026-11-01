"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Range = "24h" | "7d" | "30d";

interface Point {
  t: string;
  price: number | null;
  inStock: boolean;
}
interface Series {
  watchId: string;
  title: string;
  points: Point[];
}
interface Summary {
  lowest: number | null;
  highest: number | null;
  average: number | null;
}

const PALETTE = [
  "#c084fc", "#34d399", "#60a5fa", "#fbbf24", "#f87171",
  "#2dd4bf", "#e879f9", "#a3e635", "#fb923c", "#38bdf8",
  "#f472b6", "#86efac",
];

// Module-level cache keyed by `${productId}:${range}` so switching away from
// the History tab and back is instant instead of re-fetching every series.
// Entries expire after 2 minutes so stale data doesn't linger across polls.
const HISTORY_CACHE = new Map<string, { series: Series[]; summary: Summary | null; at: number }>();
const HISTORY_CACHE_TTL_MS = 120_000;

/** Price + stock history for one product, rendered with Recharts. Each watch
 *  (retailer listing) is its own line; in-stock samples are solid, out-of-stock
 *  samples are dimmed, so you can see both price trends and availability over
 *  time. */
export function HistoryChart({ productId, productName }: { productId: string; productName: string }) {
  const [range, setRange] = useState<Range>("7d");
  const [series, setSeries] = useState<Series[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${productId}:${range}`;
    const cached = HISTORY_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < HISTORY_CACHE_TTL_MS) {
      setSeries(cached.series);
      setSummary(cached.summary ?? null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/history?productId=${encodeURIComponent(productId)}&range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { series: Series[]; summary?: Summary }) => {
        if (cancelled) return;
        setSeries(d.series ?? []);
        setSummary(d.summary ?? null);
        HISTORY_CACHE.set(cacheKey, { series: d.series ?? [], summary: d.summary ?? null, at: Date.now() });
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, range]);

  // Merge all series into one timeline keyed by timestamp for the chart.
  const { data, allPrices } = useMemo(() => {
    const map = new Map<string, Record<string, number | string | null>>();
    const prices: number[] = [];
    for (const s of series) {
      for (const p of s.points) {
        if (p.price != null) prices.push(p.price);
        let row = map.get(p.t);
        if (!row) {
          row = { t: p.t };
          map.set(p.t, row);
        }
        row[s.watchId] = p.price;
      }
    }
    return {
      data: Array.from(map.values()).sort((a, b) => (a.t as string).localeCompare(b.t as string)),
      allPrices: prices,
    };
  }, [series]);

  const yDomain: [number | string, number | string] = useMemo(() => {
    if (allPrices.length === 0) return ["auto", "auto"];
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const pad = Math.max(1, (max - min) * 0.08);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [allPrices]);

  const totalPoints = series.reduce((n, s) => n + s.points.length, 0);

  return (
    <div className="history">
      <div className="history-head">
        <div className="history-title">{productName} · price history</div>
        <div className="range-tabs">
          {(["24h", "7d", "30d"] as Range[]).map((r) => (
            <button
              key={r}
              className={`range-tab ${range === r ? "active" : ""}`}
              onClick={() => setRange(r)}
            >
              {r === "24h" ? "24h" : r === "7d" ? "7d" : "30d"}
            </button>
          ))}
        </div>
      </div>

      {summary && (summary.lowest != null || summary.highest != null) && (
        <div className="history-summary">
          <span className="hs-stat">
            <span className="hs-l">Lowest</span>
            <span className="hs-v green">{summary.lowest != null ? `$${summary.lowest.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</span>
          </span>
          <span className="hs-stat">
            <span className="hs-l">Highest</span>
            <span className="hs-v red">{summary.highest != null ? `$${summary.highest.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</span>
          </span>
          <span className="hs-stat">
            <span className="hs-l">Average</span>
            <span className="hs-v">{summary.average != null ? `$${summary.average.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</span>
          </span>
        </div>
      )}

      {loading ? (
        <div className="history-msg">Loading history…</div>
      ) : error ? (
        <div className="history-msg err">{error}</div>
      ) : totalPoints === 0 ? (
        <div className="history-msg">No history yet — the poller needs to run a few cycles to accumulate data.</div>
      ) : (
        <>
          <div className="history-chart">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="t"
                  tickFormatter={(t: string) => fmtAxis(t, range)}
                  stroke="#5c6478"
                  fontSize={11}
                  minTickGap={40}
                />
                <YAxis
                  domain={yDomain}
                  tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
                  stroke="#5c6478"
                  fontSize={11}
                  width={52}
                />
                <Tooltip content={<PriceTooltip />} />
                {series.slice(0, 12).map((s, i) => (
                  <Line
                    key={s.watchId}
                    type="monotone"
                    dataKey={s.watchId}
                    name={s.title}
                    stroke={PALETTE[i % PALETTE.length]}
                    strokeWidth={1.6}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Stock availability timeline: in-stock vs out-of-stock over time. */}
          <div className="history-stock">
            <div className="history-stock-label">Availability</div>
            <ResponsiveContainer width="100%" height={56}>
              <AreaChart data={stockData(series)} margin={{ top: 2, right: 16, bottom: 0, left: 8 }}>
                <XAxis dataKey="t" hide />
                <YAxis domain={[0, 1]} hide />
                <Tooltip content={<StockTooltip />} />
                <Area
                  type="stepAfter"
                  dataKey="inStockRatio"
                  stroke="#34d399"
                  fill="rgba(52,211,153,0.18)"
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="history-legend">
            {series.slice(0, 12).map((s, i) => (
              <span key={s.watchId} className="legend-item">
                <span className="legend-swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
                {s.title}
                <span className="legend-count">{s.points.length}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Per-bucket fraction of the product's watches that were in stock. */
function stockData(series: Series[]) {
  const byT = new Map<string, { in: number; total: number }>();
  for (const s of series) {
    for (const p of s.points) {
      const e = byT.get(p.t) ?? { in: 0, total: 0 };
      e.total++;
      if (p.inStock) e.in++;
      byT.set(p.t, e);
    }
  }
  return Array.from(byT.entries())
    .map(([t, e]) => ({ t, inStockRatio: e.total ? e.in / e.total : 0 }))
    .sort((a, b) => a.t.localeCompare(b.t));
}

function fmtAxis(t: string, range: Range): string {
  const d = new Date(t);
  if (range === "24h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function PriceTooltip(props: { active?: boolean; payload?: { name: string; value: number | null; color: string }[]; label?: string }) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-time">{label ? new Date(label).toLocaleString() : ""}</div>
      {payload.map((p) => (
        <div key={p.name} className="tt-row">
          <span className="tt-dot" style={{ background: p.color }} />
          <span className="tt-name">{p.name}</span>
          <span className="tt-val">{p.value != null ? `$${Number(p.value).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</span>
        </div>
      ))}
    </div>
  );
}

function StockTooltip(props: { active?: boolean; payload?: { payload: { inStockRatio: number } }[]; label?: string }) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;
  const r = payload[0]!.payload.inStockRatio;
  return (
    <div className="chart-tooltip">
      <div className="tt-time">{label ? new Date(label).toLocaleString() : ""}</div>
      <div className="tt-row">
        <span className="tt-name">In stock</span>
        <span className="tt-val">{Math.round(r * 100)}%</span>
      </div>
    </div>
  );
}
