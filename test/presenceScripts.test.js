import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const toolsPath = path.join(projectRoot, "scripts", "presence-tools.ps1");
const isWindows = process.platform === "win32";

test("presence process matching handles quoted Windows paths without matching another project", {
  skip: !isWindows
}, () => {
  const entryPath = path.join(projectRoot, "src", "index.js");
  const command = [
    `. ${quotePowerShell(toolsPath)}`,
    `$entry = ${quotePowerShell(entryPath)}`,
    `$matching = '"C:\\Program Files\\nodejs\\node.exe" "' + $entry + '"'`,
    `$forwardSlash = $matching.Replace('\\', '/')`,
    `$unrelated = 'node.exe "C:\\Other Project\\src\\index.js"'`,
    `$result = [ordered]@{ matching = (Test-PresenceProcessCommandLine -CommandLine $matching -EntryPath $entry); forwardSlash = (Test-PresenceProcessCommandLine -CommandLine $forwardSlash -EntryPath $entry); unrelated = (Test-PresenceProcessCommandLine -CommandLine $unrelated -EntryPath $entry) }`,
    `$result | ConvertTo-Json -Compress`
  ].join("; ");

  const result = runPowerShell(command);
  assert.deepEqual(JSON.parse(result), {
    matching: true,
    forwardSlash: true,
    unrelated: false
  });
});

test("presence config selection preserves unrelated and nested settings", {
  skip: !isWindows
}, async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "discord presence scripts "));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const temporaryScripts = path.join(temporaryRoot, "scripts");
  const temporaryTools = path.join(temporaryScripts, "presence-tools.ps1");
  const temporaryConfig = path.join(temporaryRoot, "config.json");
  await mkdir(temporaryScripts);
  await copyFile(toolsPath, temporaryTools);
  await writeFile(temporaryConfig, JSON.stringify({
    enabled: true,
    foregroundEnabled: false,
    discordClientId: "123456789012345678",
    nested: { keep: [1, 2, 3] }
  }));

  runPowerShell([
    `. ${quotePowerShell(temporaryTools)}`,
    `Set-PresenceConfigFlags -MusicEnabled $false -BackgroundEnabled $true`
  ].join("; "));

  const config = JSON.parse(await readFile(temporaryConfig, "utf8"));
  assert.equal(config.enabled, false);
  assert.equal(config.foregroundEnabled, true);
  assert.deepEqual(config.nested, { keep: [1, 2, 3] });
});

test("presence selector switches between exactly one music or background process", {
  skip: !isWindows
}, async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "discord presence selector "));
  const temporaryScripts = path.join(temporaryRoot, "scripts");
  const temporarySource = path.join(temporaryRoot, "src");
  const temporaryTools = path.join(temporaryScripts, "presence-tools.ps1");
  const temporarySelector = path.join(temporaryScripts, "set-presence-mode.ps1");

  await mkdir(temporaryScripts);
  await mkdir(temporarySource);
  await copyFile(toolsPath, temporaryTools);
  await copyFile(
    path.join(projectRoot, "scripts", "set-presence-mode.ps1"),
    temporarySelector
  );
  await writeFile(path.join(temporaryRoot, "config.json"), JSON.stringify({
    enabled: false,
    foregroundEnabled: false,
    nested: { keep: true }
  }));
  await Promise.all([
    writeFile(path.join(temporarySource, "index.js"), "setInterval(() => {}, 1000);\n"),
    writeFile(path.join(temporarySource, "foregroundPresence.js"), "setInterval(() => {}, 1000);\n"),
    writeFile(path.join(temporarySource, "clearActivity.js"), "process.exit(0);\n"),
    writeFile(path.join(temporarySource, "clearForegroundActivity.js"), "process.exit(0);\n")
  ]);

  t.after(async () => {
    try {
      runPowerShell(`& ${quotePowerShell(temporarySelector)} -Mode Off`);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  runPowerShell(`& ${quotePowerShell(temporarySelector)} -Mode Music`);
  const firstMusicState = readProcessState(temporaryTools);
  assert.deepEqual(
    { music: firstMusicState.music, background: firstMusicState.background },
    { music: 1, background: 0 }
  );
  let config = JSON.parse(await readFile(path.join(temporaryRoot, "config.json"), "utf8"));
  assert.equal(config.enabled, true);
  assert.equal(config.foregroundEnabled, false);

  runPowerShell(`& ${quotePowerShell(temporarySelector)} -Mode Music`);
  assert.equal(readProcessState(temporaryTools).musicPid, firstMusicState.musicPid);

  runPowerShell(`& ${quotePowerShell(temporarySelector)} -Mode Background`);
  const firstBackgroundState = readProcessState(temporaryTools);
  assert.deepEqual(
    { music: firstBackgroundState.music, background: firstBackgroundState.background },
    { music: 0, background: 1 }
  );
  config = JSON.parse(await readFile(path.join(temporaryRoot, "config.json"), "utf8"));
  assert.equal(config.enabled, false);
  assert.equal(config.foregroundEnabled, true);

  runPowerShell(`& ${quotePowerShell(temporarySelector)} -Mode Background`);
  assert.equal(readProcessState(temporaryTools).backgroundPid, firstBackgroundState.backgroundPid);

  runPowerShell(`& ${quotePowerShell(temporarySelector)} -Mode Off`);
  const offState = readProcessState(temporaryTools);
  assert.deepEqual(
    { music: offState.music, background: offState.background },
    { music: 0, background: 0 }
  );

  config = JSON.parse(await readFile(path.join(temporaryRoot, "config.json"), "utf8"));
  assert.equal(config.enabled, false);
  assert.equal(config.foregroundEnabled, false);
  assert.deepEqual(config.nested, { keep: true });
});

test("saved startup launches the selected entry point and honors Off", {
  skip: !isWindows
}, async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "discord saved presence "));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const temporaryScripts = path.join(temporaryRoot, "scripts");
  const temporarySource = path.join(temporaryRoot, "src");
  const temporaryStartup = path.join(temporaryScripts, "start-saved-presence.ps1");
  const temporaryConfig = path.join(temporaryRoot, "config.json");
  await mkdir(temporaryScripts);
  await mkdir(temporarySource);
  await copyFile(toolsPath, path.join(temporaryScripts, "presence-tools.ps1"));
  await copyFile(
    path.join(projectRoot, "scripts", "start-saved-presence.ps1"),
    temporaryStartup
  );
  await Promise.all([
    writeFile(path.join(temporarySource, "index.js"), "console.log('MUSIC_ENTRY');\n"),
    writeFile(path.join(temporarySource, "foregroundPresence.js"), "console.log('BACKGROUND_ENTRY');\n"),
    writeFile(path.join(temporarySource, "clearActivity.js"), "process.exit(0);\n"),
    writeFile(path.join(temporarySource, "clearForegroundActivity.js"), "process.exit(0);\n")
  ]);

  await writeFile(temporaryConfig, JSON.stringify({
    enabled: false,
    foregroundEnabled: true
  }));
  let output = runPowerShell(`& ${quotePowerShell(temporaryStartup)}`);
  assert.match(output, /BACKGROUND_ENTRY/);
  assert.doesNotMatch(output, /MUSIC_ENTRY/);

  await writeFile(temporaryConfig, JSON.stringify({
    enabled: true,
    foregroundEnabled: false
  }));
  output = runPowerShell(`& ${quotePowerShell(temporaryStartup)}`);
  assert.match(output, /MUSIC_ENTRY/);
  assert.doesNotMatch(output, /BACKGROUND_ENTRY/);

  await writeFile(temporaryConfig, JSON.stringify({
    enabled: false,
    foregroundEnabled: false
  }));
  output = runPowerShell(`& ${quotePowerShell(temporaryStartup)}`);
  assert.match(output, /Saved presence choice is Off/);
  assert.doesNotMatch(output, /_ENTRY/);
});

function runPowerShell(command) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command
  ], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function readProcessState(temporaryTools) {
  const output = runPowerShell([
    `. ${quotePowerShell(temporaryTools)}`,
    `$music = @(Get-PresenceProcesses -Mode Music)`,
    `$background = @(Get-PresenceProcesses -Mode Background)`,
    `[ordered]@{ music = $music.Count; background = $background.Count; musicPid = $(if ($music.Count) { $music[0].ProcessId } else { 0 }); backgroundPid = $(if ($background.Count) { $background[0].ProcessId } else { 0 }) } | ConvertTo-Json -Compress`
  ].join("; "));
  return JSON.parse(output);
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
