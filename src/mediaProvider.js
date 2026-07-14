import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { rootDir } from "./config.js";

const execFileAsync = promisify(execFile);

export async function readMediaSessions({ timeoutMs = 5000 } = {}) {
  const scriptPath = path.join(rootDir, "scripts", "read-media-sessions.ps1");

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    {
      cwd: rootDir,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    }
  );

  const output = stdout.trim();
  if (!output) {
    return [];
  }

  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}
