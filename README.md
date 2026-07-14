# Local Apple Music Discord Presence

A from-scratch Windows bridge that reads the current Apple Music track from the local Windows media session API and publishes it to Discord Rich Presence through Discord desktop's local IPC pipe. It also has an opt-in YouTube Music listen-along mode that can follow another Discord user's visible Spotify activity.

It does not use the `discord-music-presence` codebase. The implementation is independent and intentionally small and auditable: no third-party npm packages, no telemetry, and no auto-updater. The default local mode makes no direct HTTP requests; optional artwork, browser inspection, and listen-along features use the network only when enabled.

This is an independent community project and is not affiliated with, endorsed by, or sponsored by Apple Inc. or Discord Inc. Apple Music, Apple, Discord, and related marks belong to their respective owners.

## Privacy Boundary

The default presence publisher only talks to:

- Windows' local media session API, to read what Apple Music is playing.
- Discord desktop's local named pipe, to set or clear Rich Presence.

There is one unavoidable boundary: if your friends can see the status on Discord, Discord receives that presence data from your Discord client. A Discord status cannot be visible to others without being sent to Discord. This project avoids third-party servers and avoids direct internet requests from the bridge itself.

Album artwork is not uploaded or fetched in the default config. Fully dynamic album artwork is not compatible with a strict local-only rule because the image URL has to reach Discord to be visible to other people. You can opt into automatic Apple artwork with `artworkMode: "itunes"`.

The optional listen-along process has a different boundary: it connects to Discord's Gateway as your bot and controls a visible YouTube Music tab through a debugger endpoint bound to your own computer. It does not send the bot token to the browser or store it in the config file.

## Requirements

- Windows 10/11.
- Discord desktop app running.
- Apple Music for Windows playing media.
- Node.js 22 or newer.
- A Discord application client ID.

## Setup

1. Create a Discord application in the Discord Developer Portal, name it `Apple Music`, upload the Apple Music icon as its application icon, and copy its Application ID. The application name and icon are what Discord uses in the `Listening to Apple Music` header.
2. Copy `config.example.json` to `config.json`.
3. Put the Application ID into `discordClientId`.
4. Start Discord desktop.
5. Play a song in Apple Music.
6. Double-click `music-presence.cmd`, or run:

```powershell
npm.cmd start
```

For background app/window presence instead, double-click `background-presence.cmd` or run:

```powershell
npm.cmd run presence:background
```

## Choose What Discord Displays

The project now has three double-clickable files in the main folder:

- `music-presence.cmd` shows the currently playing music.
- `background-presence.cmd` runs in the background and shows the app/window you are actively using.
- `stop-presence.cmd` turns both project presences off and clears them from Discord.

Music and background app presence are exclusive choices. Starting either one stops the other first, so this project will not create a second `+1` activity in Discord. The choice is also saved to `config.json` through the separate `enabled` and `foregroundEnabled` switches.

The same choices can be run from PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-music-presence.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-background-presence.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-all-presence.ps1
```

Or through npm:

```powershell
npm.cmd run presence:music
npm.cmd run presence:background
npm.cmd run presence:off
```

PowerShell script execution policy does not affect the app at runtime because Node launches the bundled reader script with `-ExecutionPolicy Bypass`.

## Full First Run Checklist

1. Open https://discord.com/developers/applications in your browser.
2. Click New Application.
3. Name it `Apple Music` if you want Discord to show `Listening to Apple Music`.
4. Open the new application and copy Application ID.
5. In this project folder, copy `config.example.json` to `config.json`.
6. Paste the Application ID into `discordClientId`.
7. Open the Discord desktop app. The web version cannot receive local IPC updates.
8. Open Apple Music for Windows and play a track.
9. Double-click `music-presence.cmd`.
10. Check your Discord profile/status from another account or ask a friend to look.
11. Double-click `stop-presence.cmd` when you want to turn it off.

After it works once, install start-on-login with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-startup.ps1
```

## Album Art

There are three realistic choices:

- Strict local-only: use no dynamic cover art. This is the default.
- Static artwork: upload one image to your Discord application's Rich Presence assets, then set `largeImageKey` in `config.json`. This gives the presence an icon without sending every album cover.
- Manual per-album artwork: upload album covers to your Discord application's Rich Presence assets, then map album names to asset keys in `config.json`. The bridge still makes no cover-art web requests while you listen.
- Automatic per-track artwork: set `artworkMode` to `"itunes"`. The bridge sends artist/title searches to Apple's iTunes Search API and sends the returned artwork URL to Discord. The banner changes automatically when the song changes, but this is outside the strict local-only privacy promise.

To enable automatic banners:

```json
{
  "artworkMode": "itunes",
  "artworkCountry": "US",
  "artworkSize": 600
}
```

Use `"IN"` for `artworkCountry` if your Apple Music catalog is India, or another two-letter country code that matches your catalog.

For a static image, go to your Discord application, open Rich Presence assets, upload a square image, then set:

```json
{
  "largeImageKey": "your_uploaded_asset_key"
}
```

Keep the rest of your `config.json` values too; this snippet only shows the one field to change.

For the current song in your screenshot, upload the `Currents` cover as a Rich Presence asset. Discord lowercases asset keys, so name or copy the key as `currents`, then add:

```json
{
  "largeImageKey": "apple-music",
  "albumImageKeys": {
    "Tame Impala - Currents": "currents",
    "Currents": "currents"
  }
}
```

The app checks these keys in order: `Artist - Album`, `Album`, `Artist - Song`, then `Song`. `largeImageKey` is the fallback image for albums you have not mapped yet.

## Config

`config.json` supports:

- `discordClientId`: Required Discord application ID.
- `enabled`: Local kill switch for music presence. Set to `false` to prevent music from being shared.
- `foregroundEnabled`: Local kill switch for background app presence. Selecting Music or Background makes one switch true and the other false; Off makes both false.
- `onlyAppleMusic`: Defaults to `true` so other players are ignored.
- `playerPatterns`: App identifiers used to recognize Apple Music.
- `showPaused`: Defaults to `false`, matching Spotify-like behavior.
- `activityType`: Defaults to `2`, Discord's Listening activity type.
- `activityNameTemplate`: Defaults to `{player}`, which asks Discord to show `Listening to Apple Music` for an Apple Music session.
- `statusDisplayType`: Defaults to `0`, which asks Discord's member list to use the activity name. Use `1` to show `state`, or `2` to show the song title from `details`.
- `includeAlbumInState`: Appends album text after the artist.
- `artworkMode`: Defaults to `off`. Set to `itunes` for automatic album banners from Apple's public Search API.
- `artworkCountry`: Storefront country for automatic artwork lookup, such as `US` or `IN`.
- `artworkSize`: Image size requested from Apple's artwork CDN.
- `largeImageKey`: Optional static Discord Rich Presence asset key.
- `albumImageKeys`: Optional mapping from album/song names to uploaded Discord Rich Presence asset keys.

If you upload a static icon to your Discord application assets, set `largeImageKey` to that asset key. Automatic album covers require `artworkMode: "itunes"` and internet access to Apple and Discord.

## Start On Login

After `config.json` is set, install one startup task:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-startup.ps1
```

At each login it resumes whichever choice was last selected with `music-presence.cmd` or `background-presence.cmd`. If `stop-presence.cmd` was used last, it stays off.

If the startup task was installed before these selector files were added, run the installer once again to update that task.

To remove it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-startup.ps1
```

## Legacy Music Toggle Aliases

These older script names remain available for existing shortcuts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/disable-presence.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/enable-presence.ps1
```

`disable-presence.ps1` stops music only. `enable-presence.ps1` now selects music exclusively, just like `music-presence.cmd`. Discord's own game/app activity controls stay in Discord's Activity Privacy and Registered Games settings.

## Follow A Friend On YouTube Music

Listen-along is a separate, opt-in process. It watches one person's visible Spotify activity through a Discord bot, searches for the corresponding song in a logged-in YouTube Music browser tab, starts at the source timestamp, and periodically corrects playback drift. When the source song changes, the YouTube Music song changes too. When the source activity disappears, the destination pauses after a short grace period.

This first version supports YouTube Music in Chrome or Brave. It does not control the installed Apple Music app. Windows can play, pause, and seek that app, but it does not expose a supported command for loading an arbitrary catalog song. Apple Music follow-along would require a separate MusicKit web player, Apple developer credentials, and subscriber authorization.

### Limitations

- The bot and the target user must share at least one Discord server. A friend or DM-only presence is not available through Discord's supported bot API.
- The target must share activity status, and the bot application must have the Presence Intent enabled.
- YouTube Music matching is best effort. Remasters, covers, live versions, regional availability, ads, buffering, and crossfade can prevent an exact match or perfect synchronization.
- Browser control uses YouTube Music's current page structure, not an official YouTube Music remote-control API. A future site redesign may require selector updates.
- This mode contacts Discord and YouTube Music and opens a local Chrome debugging endpoint. It is outside the original local-only privacy boundary.
- Do not use a Discord user token. User-account automation (a self-bot) is unsupported; this implementation accepts only a bot token.

### One-time Discord setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application, or use a separate application you own.
2. Open its **Bot** page, create a bot, and enable **Presence Intent** under Privileged Gateway Intents.
3. Use OAuth2 URL Generator with the `bot` scope to add it to a server that also contains the person you want to follow. It does not need channel permissions.
4. In Discord, enable Developer Mode under Advanced. Right-click the target user, choose **Copy User ID**, and keep that ID for the config below.
5. Reset the bot token immediately if it is ever pasted into chat, committed, or otherwise exposed.

### Configure and run

Keep the token out of `config.json`. Add this block to your existing config and replace the user ID:

```json
{
  "listenAlong": {
    "enabled": true,
    "targetDiscordUserId": "123456789012345678",
    "destination": "youtubeMusic",
    "browserDebuggingPorts": [9222, 9223],
    "syncIntervalMs": 2000,
    "missingGraceMs": 5000,
    "driftToleranceMs": 3000,
    "minimumRemainingMs": 5000,
    "searchTimeoutMs": 12000
  }
}
```

The snippet only shows the new section; preserve the other settings already in your file.

Start a dedicated controllable Chrome profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-browser-debugging.ps1 -Browser Chrome -ForceRestart
```

`-ForceRestart` closes running instances of that browser. Omit it if Chrome is already closed. The script opens `music.youtube.com` in a dedicated profile under `cache`; sign in once, play any song once if the browser asks for interaction, and leave that tab open.

Start the follower. It prompts for the bot token with hidden input and keeps it out of PowerShell command history and `config.json`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-listen-along.ps1
```

Stop with `Ctrl+C`. The script removes its temporary environment variable on exit. The existing `npm.cmd start` presence publisher and this follower are independent; either or both can run. `npm.cmd run listen-along` is also available when `DISCORD_BOT_TOKEN` is already supplied by a trusted secret manager.

Optional tuning:

- Increase `driftToleranceMs` if you hear too many seeks.
- Increase `missingGraceMs` if brief Discord presence gaps pause too aggressively.
- Increase `searchTimeoutMs` on a slow connection.
- Use port `9223` and `-Browser Brave -Port 9223` for Brave.

## Background App Presence (Focused Window)

This mode runs quietly in the background. It watches the focused window on your primary monitor and shares only whitelisted activities.

The internal configuration keys still use the `foreground*` prefix because they describe the foreground (focused) window being reported.

Start it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-background-presence.ps1
```

Stop it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-background-presence.ps1
```

The stop script also clears the last Discord background app activity. The selector scripts safely republish the chosen mode when both modes use the same Discord application ID.

Default foreground rules:

- `Codex` -> `Talking to Codex`
- browser tab title containing `YouTube` -> `Watching YouTube`
- browser tab title containing `Amazon` or `Amazon.in` -> `Browsing Amazon.in`
- `Brave` -> `Browsing Brave`
- `Steam` -> `Browsing Steam`

Unknown apps are not shared unless `foregroundShowUnknownApps` is set to `true`. Keep it `false` if you do not want private document titles, chats, or work tools to leak into Discord.

The foreground rules include logo URLs using Google's favicon service. Discord has to fetch those images to show logos, so this is not a strict no-internet-assets mode. To avoid that, replace each `largeImage` URL with a Discord Rich Presence asset key you uploaded yourself.

If Discord still shows `+1`, another application outside this project is also publishing an activity. Re-run one of the selector files above to ensure only one bridge from this project is active.

### YouTube Links And Timestamps

Window titles do not include the YouTube URL or playback position. To show a clickable `Watch on YouTube` button and video progress timestamps, start Chrome or Brave with local debugging enabled:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-browser-debugging.ps1 -Browser Chrome -ForceRestart
```

For Brave:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-browser-debugging.ps1 -Browser Brave -Port 9223 -ForceRestart
```

Then start background app presence:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-background-presence.ps1
```

This lets the bridge read the active YouTube tab from `127.0.0.1` only. It does expose browser debugging to local programs on your machine while that browser is open, so use it only if you trust your local environment.

Optional foreground config:

```json
{
  "foregroundClientId": "",
  "foregroundPrimaryMonitorOnly": true,
  "foregroundShowUnknownApps": false,
  "foregroundRules": [
    {
      "processNames": ["codex"],
      "name": "Codex",
      "type": 0,
      "details": "Talking to Codex"
    },
    {
      "processNames": ["chrome", "msedge", "brave", "firefox"],
      "titleIncludes": ["youtube"],
      "name": "YouTube",
      "type": 3,
      "details": "Watching YouTube",
      "stateTemplate": "{webTitle}"
    }
  ]
}
```

Use a separate Discord application ID in `foregroundClientId` if you do not want this to share the same app identity as the music presence.

## Troubleshooting

- If it says Discord IPC cannot connect, make sure Discord desktop is open. Browser Discord is not enough.
- If no status appears, check that your Discord application ID is correct.
- If Apple Music is ignored, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/read-media-sessions.ps1` while music is playing and add the returned `sourceAppUserModelId` text to `playerPatterns`.
- If another player appears, keep `onlyAppleMusic` set to `true`.

## Development Checks

```powershell
node --test
```
