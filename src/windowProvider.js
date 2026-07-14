import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { rootDir } from "./config.js";

const execFileAsync = promisify(execFile);

export async function readForegroundWindow({ timeoutMs = 3000 } = {}) {
  const scriptPath = path.join(rootDir, "scripts", "read-foreground-window.ps1");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    {
      cwd: rootDir,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 256 * 1024
    }
  );

  const output = stdout.trim();
  if (!output || output === "null") {
    return null;
  }

  return JSON.parse(output);
}
