import { runCollection } from "../lib/collector";

try {
  process.loadEnvFile(".env");
} catch {
  // Next loads environment files automatically. The CLI keeps working when no local file exists.
}

async function main(): Promise<void> {
  const slot = process.argv[2] || "manual_cli";
  try {
    const result = await runCollection(slot);
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Collection failed");
    process.exitCode = 1;
  }
}

void main();
