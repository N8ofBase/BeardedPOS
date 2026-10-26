// Copies the files the store Lambda reads at run time (the migrations and the RDS certificate bundle)
// next to its bundle. Run by the CDK during bundling; plain Node so it works on Windows and Linux.
import { cpSync } from "node:fs";
import { join } from "node:path";

const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir) throw new Error("Usage: copy-store-lambda-files.mjs <repo root> <bundle dir>");
const api = join(inputDir, "services", "store-api");
cpSync(join(api, "migrations"), join(outputDir, "migrations"), { recursive: true });
cpSync(join(api, "certs", "rds-global-bundle.pem"), join(outputDir, "rds-global-bundle.pem"));
