import type { RetailerAdapter } from "@stockwatch/types";

/**
 * Re-export the adapter contract so consumers depend on @stockwatch/adapters
 * rather than reaching into @stockwatch/types directly.
 */
export type { RetailerAdapter } from "@stockwatch/types";
