import type { RetailerAdapter } from "@stockwatch/types";

import { NeweggAdapter } from "./newegg/index";
import { MsiAdapter } from "./msi/index";
import { AmazonAdapter } from "./amazon/index";
import { LdlcAdapter } from "./ldlc/index";
import { BestBuyAdapter } from "./bestbuy/index";

/**
 * Adapter registry. Mirrors bfms/dealbots `retailers/registry.py`:
 * a map of retailer id -> adapter factory. Adding a retailer is one file
 * (the adapter) plus one line here.
 */
const _factories = new Map<string, () => RetailerAdapter>();

function register(id: string, factory: () => RetailerAdapter): void {
  _factories.set(id, factory);
}

// --- Built-in adapters -------------------------------------------------------
register("newegg", () => new NeweggAdapter());
register("msi", () => new MsiAdapter());
register("amazon", () => new AmazonAdapter());
register("ldlc", () => new LdlcAdapter());
register("bestbuy", () => new BestBuyAdapter());

/** List all registered retailer ids. */
export function listAdapters(): string[] {
  return [..._factories.keys()];
}

/** Get an instance of the adapter for `id`. Throws if unregistered. */
export function getAdapter(id: string): RetailerAdapter {
  const factory = _factories.get(id);
  if (!factory) {
    throw new Error(`No adapter registered for retailer: ${id}`);
  }
  return factory();
}

/** Eagerly instantiate all (or a subset of) registered adapters. */
export function getAdapters(ids?: readonly string[]): RetailerAdapter[] {
  const wanted = ids && ids.length > 0 ? ids : listAdapters();
  return wanted.map((id) => getAdapter(id));
}
