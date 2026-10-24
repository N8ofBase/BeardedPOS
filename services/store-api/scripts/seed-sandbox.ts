// npm run seed:sandbox            shows what would be copied into the Square Sandbox
// npm run seed:sandbox -- --write  copies it
// Reads SQUARE_SANDBOX_ACCESS_TOKEN (and optional SQUARE_LOCATION_ID) from the environment or services/store-api/.env.
import { SquareApiStore } from "../src/square/live.ts";
import { applySeed, planSeed } from "../src/square/sandboxSeed.ts";
import { loadSnapshot } from "../src/square/snapshot.ts";

const token = process.env.SQUARE_SANDBOX_ACCESS_TOKEN;
if (!token) {
  console.error("Set SQUARE_SANDBOX_ACCESS_TOKEN first (see services/store-api/.env.example).");
  process.exit(1);
}
const square = new SquareApiStore({
  mode: "sandbox",
  token,
  locationId: process.env.SQUARE_LOCATION_ID || undefined,
});
const saved = loadSnapshot();
const plan = planSeed(saved, await square.catalog());
console.log(`Sandbox location: ${await square.locationId()}`);
for (const name of plan.skip) console.log(`  already there: ${name}`);
for (const item of plan.add)
  for (const v of item.variations)
    console.log(
      `  add: ${item.name} (${v.name}) $${(v.priceCents / 100).toFixed(2)}${v.stock === null ? "" : `, ${v.stock} in stock`}`,
    );
if (!process.argv.includes("--write")) {
  console.log(plan.add.length ? "Dry run. Run again with --write to copy these." : "Nothing to copy.");
} else {
  console.log(`Copied ${await applySeed(square, plan, saved.currency)} variations into the Sandbox.`);
}
