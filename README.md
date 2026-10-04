# Dust Wave Downloader 0.1.8

An unpacked Chrome extension for saving individual videos and original audio. It detects media automatically on websites, offers the qualities it can read, and combines tracks locally when needed. No account, native companion, server, or FFmpeg installation is required.

This is an initial build. See [VALIDATION.md](VALIDATION.md) for the exact tested sites and remaining limits.

## Install

Build the unpacked extension from this repository:

```sh
npm ci
npm run build
```

1. Keep this repository in a permanent folder.
2. Open `chrome://extensions` in desktop Chrome 125 or newer.
3. Enable **Developer mode**, click **Load unpacked**, and select the **extension** folder inside this repository.
4. Pin **Dust Wave Downloader** from Chrome's extensions menu.
5. Reload any media pages that were already open.

The same extension folder is designed for Chrome on macOS, Windows, and Linux. Browser tests were run on macOS; Windows and Linux have not been tested. Chrome on iPhone/Android is outside scope. Helium was also tested on macOS; other Chromium browsers have not been validated.

To update, pull the latest source, run `npm ci` and `npm run build`, then click **Reload** on the extension's card in `chrome://extensions` and refresh open media pages. Keep the folder in place while installed.

## Changes in 0.1.8

- Connection-check and rescan replies now use the same extension-context guard as message sending and initialization. If a reply loses its context during an extension reload, the old detector stops its listeners, timer, and observer without throwing.
- Added coverage for non-media HTML, empty documents, SVG/XML documents, page updates, and extension reloads. Unrelated programming errors remain visible.

Refresh already-open pages once after updating to replace older detector instances.

## Changes in 0.1.7

- A larger cyan source dot with a dark outline is easier to see on the pinned toolbar icon.
- Cancel stops the toolbar and popup download animation immediately, even while the engine cleans up. Delayed progress cannot restart it, and a recent detection pulse does not resume afterward.
- The popup shows “Cancelling…” during cleanup and keeps another download from starting until the engine is ready.

## Changes in 0.1.6

- Compressed HLS playlists are fetched whole. This fixes the reproduced Vimeo decoding failure caused by requesting byte ranges of its compressed playlist; byte ranges remain enabled for media files and segments.
- Expected network-retry messages are debug diagnostics, while final failures still appear in the popup and unrelated library errors remain visible. Network failures no longer incorrectly claim that the server denied access.
- A compact cyan dot replaces the large native source-count badge. The full media-item count remains in the tooltip and popup.
- The pinned icon has stronger motion, a longer detection pulse, and replays that pulse when returning to a media tab, rescanning, or pinning it. Download animation continues with the popup closed; idle browsing stops the animation timer.

## Changes in 0.1.5

- Content-script initialization now checks the extension context and handles invalidation during listener registration, in addition to the existing message-send guards.
- Rescan checks that the main page is connected, reinstalls missing page scripts, and requires an acknowledgment. If the page cannot reconnect, the popup asks you to refresh it instead of reporting a successful scan.
- Healthy and repeated rescans keep their existing detector. No permission or dependency was added.

Refresh already-open media pages once after updating so they use the new initialization guard. Use **Errors → Clear all** to remove previously recorded errors.

## Changes in 0.1.4

- Page detectors stop their observers, timers, and listeners when an extension reload invalidates their context. Both synchronous throws and rejected messages are handled.
- HTTP 401/403/404 and other permanent failures are no longer retried with the same URL. Temporary network/server failures retain one retry. Error response bodies are released promptly.
- A genuine site refusal remains a handled message in the popup; this update does not grant access to a source the server denies.

After updating, reload the extension and refresh already-open media pages to replace their old scripts. Chrome retains historical errors: use **Errors → Clear all** once after refreshing. An error mentioning a previous engine filename may be a saved entry from an earlier version.

## Changes in 0.1.3

- Vimeo variants group into one card per video, including streams observed before the embedded player reports its identity. Separate embedded videos keep separate cards.
- Vimeo previews use its current player metadata, older player posters, and page metadata. A late poster/title enriches the existing card.
- Both dropdown arrows have consistent right padding and space from their labels.
- Vimeo's proprietary JSON playlist is no longer incorrectly offered as DASH; available HLS and actual MPD manifests remain supported.

## Changes in 0.1.2

- A clearly filled progress bar and visible percentage while downloading and assembling media. Updates include the latest progress from each network burst.
- An animated indicator when the source does not provide a total size, with transferred bytes still shown. Motion respects reduced-motion preferences.
- The bar updates in place and restores the current progress when the popup is reopened. Saving is shown separately; completion is reported only after Chrome finishes saving.

## Changes in 0.1.1

- New cyan/magenta pixel-download icon, inspired by ASCII VJ REMIX.
- A brief toolbar pulse when a new media item is detected. Animated pixels while a download is active, including when the popup is closed. The popup icon also animates; its motion respects reduced-motion preferences. Idle browsing has no animation timer.
- YouTube watch/Shorts variants group into one card per video, with all discovered sources retained. Late player metadata fills in the title and preview; a video-specific thumbnail is the fallback.

**Updating a separate existing installation:** copy the freshly built `extension` contents into the folder already loaded by Chrome, click **Reload**, and refresh the media page. The bundled public key keeps the extension ID unchanged.

## Use

Open a media page and play the item briefly. Open the extension, click **Choose quality**, choose **Video** or **Audio only**, select an available quality, and click **Download**. The pencil changes the filename. The Downloads view shows progress, cancellation, and **Show in folder**.

You can close the popup during a download. Keep Chrome open. One download or quality inspection runs at a time. Files go to Chrome's configured download folder; **Settings → Ask where to save each file** enables the file picker.

For a signed-in page, sign in normally in that Chrome profile and play the item. The extension uses browser-managed authentication and the originating page's Referer. It does not export cookies. A site's authentication, expired links, or protected player can still prevent a download.

If media is missing, select the desired quality in the site's player, play it, and click **Rescan**. Not all sites expose every quality. Several cards can represent a master playlist and its individual streams; inspect the master/combined item first when available. Carousel clips remain individual items.

## Formats and limits

- Direct media files; finite HLS streams; clear, static DASH SegmentTemplate/SegmentTimeline/SegmentList streams.
- Video/audio merging and audio extraction preserve encoded media. No transcoding, upscaling, MP3 conversion, batch downloads, playlists, or live recording.
- AAC audio saves as M4A; MP3 stays MP3; Opus/Vorbis use Ogg; other supported codecs retain a compatible container. The selected output format is shown before download.
- Protected media and some DASH SegmentBase layouts are unsupported. YouTube's SABR transport and cipher-only player responses are unsupported. YouTube support is experimental and is not a reason to rely on this build.
- Temporary output is streamed to Chrome's private disk storage, then handed to Chrome's download manager. Allow disk space for the temporary file and saved copy. Quitting Chrome interrupts assembly; restart the download from its page. There is no resumable queue.

## Privacy and permissions

No analytics, upload service, remote executable code, cookie export, or native component. Network requests go to the visited sites and their media/image hosts. Source URLs and detected items live in a bounded Chrome session cache; closing a tab clears its items. Closing Chrome clears the session cache. Chrome retains its normal download history. Only the two settings persist in extension local storage.

| Permission | Purpose |
| --- | --- |
| HTTP/S access to all sites | Automatic detection everywhere, including embedded players and their CDNs, as requested. |
| webRequest | Observe media response URLs and content types. It does not read request bodies. |
| scripting / activeTab | Rescan pages opened before installation. |
| storage | Temporary discovery/jobs and persistent settings. |
| offscreen | Inspect and assemble files after the popup closes. |
| downloads | Save completed files, show progress, cancel, and reveal files. |
| declarativeNetRequestWithHostAccess | Set the originating page's Referer only on extension-initiated media requests while inspecting/downloading. |

Automatic detection can be paused in Settings. Broad host access is still shown by Chrome because it is part of the installed manifest.

## Develop

Plain JavaScript, HTML, CSS, and Manifest V3. The small popup/background code loads the bundled media engine only when a quality inspection or download needs it. Two runtime dependencies are pinned: Mediabunny 1.61.0 and mpd-parser 1.4.0.

```sh
npm ci
npm run build
npm test
```

For installed-extension integration tests, install Playwright's Chromium (`npx playwright install chromium`) and have `ffmpeg`/`ffprobe` available **on the development machine only**:

```sh
npm run fixtures
npm run test:browser
npm run test:youtube
npm run test:vimeo
npm run test:errors
npm run test:rescan
npm run test:toolbar
npm run test:nonmedia
```

Tests generate synthetic media, load the actual unpacked extension into a disposable Chromium profile, save files into `test-results`, and independently inspect/decode them. They do not alter your normal Chrome profile. `tests/live.mjs` checks public site samples; `DOWNLOADS=1` additionally downloads selected media into `test-results/live/downloads`. Live pages change and may show account or verification gates.

Generated builds, synthetic fixtures, browser profiles, downloaded test media, and reports stay outside Git. Run `npm run clean` after testing to remove them; it retains `node_modules` for the next development session. If Chrome loads this repository's `extension` directory directly, rebuild before reloading the extension.

The repository retains the fixture generator and test harnesses, not old builds or test recordings. `VALIDATION.md` summarizes prior acceptance and current limits. New reports are written under `test-results/`.

`extension-key.txt` contains a **public** Chrome extension identity key, not a signing secret. Keep it in Git so local builds retain the same extension ID. Never commit browser profiles, session cookies, signed media URLs, or private keys.

The icon artwork is in `assets/downloader-icon.png`. `npm run icons` regenerates the bundled PNG sizes and animation frames using Playwright; normal builds use the checked-in PNGs and do not need an image-generation service.

## Source and licenses

Source is included in `src/` and `static/`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The built extension includes full dependency license notices. Corresponding unmodified third-party source archives are provided in `third-party-source/`, including Mediabunny's MPL-2.0 source. Build tools are development dependencies only.
