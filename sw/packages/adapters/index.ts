export { getAdapter, getAdapters, listAdapters } from "./registry";
export type { RetailerAdapter } from "./base";
export { NeweggAdapter, NEWEGG_REFURB_ITEM_RE, NEWEGG_OPEN_BOX_ITEM_RE } from "./newegg/index";
export { MsiAdapter, setMsiFetcher, canonicalUsUrl as canonicalMsiUsUrl } from "./msi/index";
export { AmazonAdapter, setAmazonHtmlFetcher, WafChallengeError, isWafWall } from "./amazon/index";
export { LdlcAdapter, setLdlcFetcher } from "./ldlc/index";
export {
  BestBuyAdapter,
  setBestBuyFetcher,
  setBestBuyKnownSkus,
  bestBuyKnownSkuCount,
  type BestBuyKnownSku,
} from "./bestbuy/index";
export { normalizeGpuTitle, extractGpuMpn, looksLikeMpn, inferGpuBrand } from "./normalize";
export { GPU_CATALOG, GPU_BY_MPN, classifyGpuModel, classifyListingCategory, RENEWED_OR_REFURBISHED_RE } from "./gpu-catalog";
export type { GpuModel, ListingCategory } from "./gpu-catalog";
export { RateLimitError } from "./errors";
export { getNeweggGateState } from "./newegg/search";
