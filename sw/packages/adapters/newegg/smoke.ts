import { NeweggAdapter } from "./index.js";

export { NeweggAdapter } from "./index.js";

// Quick manual smoke test:
//   pnpm --filter @stockwatch/adapters exec tsx src/newegg/smoke.ts -- "rtx 5090"
//   pnpm --filter @stockwatch/adapters exec tsx src/newegg/smoke.ts -- "rtx 5090" --first-party
async function main(): Promise<void> {
  const query = process.argv[2] ?? "rtx 5090";
  const firstPartyOnly = process.argv.includes("--first-party");
  const adapter = new NeweggAdapter();
  const listings = await adapter.search(query, {
    maxPages: 2,
    maxResults: 20,
    firstPartyOnly,
  });
  console.log(
    `\nquery="${query}" firstPartyOnly=${firstPartyOnly} -> ${listings.length} listing(s)\n`,
  );
  for (const l of listings) {
    console.log(
      [
        l.status === "in_stock" ? "IN " : "OUT",
        l.firstParty ? "1P" : "3P",
        l.price != null ? `$${l.price}` : "  —",
        `seller=${l.seller ?? "Newegg"}`,
        l.title.slice(0, 60),
      ].join("  "),
    );
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
