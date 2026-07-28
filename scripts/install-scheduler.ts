import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const escapeXml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

async function main(): Promise<void> {
  const projectRoot = resolve(__dirname, "..");
  const launchAgents = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(launchAgents, "local.scout.job-collector.plist");
  const pnpmPath = execFileSync("which", ["pnpm"], { encoding: "utf8" }).trim();
  const userId = process.getuid?.();
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.scout.job-collector</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(pnpmPath)}</string>
    <string>run</string>
    <string>scheduler:tick</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(projectRoot)}</string>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(projectRoot, "data", "scheduler.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(projectRoot, "data", "scheduler-error.log"))}</string>
</dict>
</plist>
`;

  await mkdir(launchAgents, { recursive: true });
  await writeFile(plistPath, plist, "utf8");
  if (userId !== undefined) {
    try { execFileSync("launchctl", ["bootout", `gui/${userId}`, plistPath], { stdio: "ignore" }); } catch { }
    execFileSync("launchctl", ["bootstrap", `gui/${userId}`, plistPath]);
  }
  console.log(`Installed scheduler at ${plistPath}`);
}

void main();
