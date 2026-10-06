# Validation

Last source changes: version 0.1.10, October 6, 2026. These observations describe tested behavior, not universal support for a website. Generated reports, profiles, recordings, and old builds are intentionally excluded from this repository.

## Reproduce locally

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run fixtures
npm run test:browser
npm run test:youtube
npm run test:vimeo
npm run test:errors
npm run test:rescan
npm run test:toolbar
npm run test:nonmedia
```

Browser checks use disposable profiles and generated media. Install FFmpeg and ffprobe on the development machine to generate fixtures and independently inspect/decode completed files. The extension itself needs neither program. Reports and downloaded files are written under `test-results/`. Use `npm run clean` to remove reproducible output afterward.

The YouTube, rescan, toolbar, and non-media harnesses accept `CHROMIUM_EXECUTABLE`, `EXTENSION_DIR`, and `RESULTS_DIR` overrides. Helium was also tested on macOS. Windows and Linux still need native acceptance testing.

## YouTube public player fallback — October 6, 2026

Version 0.1.10 adds an extension-only fallback for public/unlisted YouTube videos whose web response exposes SABR, unresolved signatures, or refused observed sources. It obtains an anonymous visitor context and asks the VISIONOS player client for compatible direct tracks, then uses the existing inspection/merging/saving engine. It does not parse SABR packets, execute downloaded player scripts, or use a native helper. Client changes and account/verification requirements can still prevent downloading.

The supplied unlisted video initially had zero direct sources and a SABR marker in a disposable Chromium 153 profile. The real popup's **Choose quality** offered 1080p, 720p, 360p and 144p video plus AAC/Opus audio. A complete 1920×1080 H.264/Opus MP4 (312.761 seconds, 27,126,094 bytes) and AAC M4A (312.819 seconds, 5,062,091 bytes) both saved successfully with the popup closed. Both passed independent ffprobe inspection and full FFmpeg decode. The final request-rule list was empty. Reports: `test-results/youtube-live/results.json` and `qualities.png`.

The source passes 38 unit checks, seven controlled YouTube browser cases, 18 download/progress checks, nine error/context checks, and five rescan/reload checks. New cases verify source-less SABR/cipher cards can request a lookup, observed HTTP denial falls back once, lookup failure preserves original sources and clears temporary rules, rescan clears stale errors, and navigation from the YouTube homepage to a watch page preserves the current video URL. The SPA case reproduced `sender.url` retaining the initial document URL; discovery now accepts the content detector's current URL only within the verified sender origin. Unit coverage checks matching video identity, anonymous request options, response bounds, format/host validation, retaining audio with many video qualities, and live/DRM/account gates.

The disposable Helium automation again aborted navigation before playback; this is not download acceptance in Helium. The normal Helium extension details identified the existing `~/Documents/dust-wave-downloader/extension` installation at 0.1.8. Its folder was backed up, replaced with byte-identical 0.1.10 build output, and reloaded. The extension details visibly confirmed **0.1.10** and **Reloaded**. An initial signed-in popup test still refused inspection. A separately reproduced stale-URL bug prevented fallback after YouTube navigation within a page; that fix is now also in the installed folder. Reload and signed-in retest of this final change are pending. Complete saved-file acceptance above was in Chromium.

A separate disposable Helium 154 check prefilled the known SABR video identity to isolate the download pipeline from the automated navigation failure. The real popup lookup, inspection, video merge, audio export, and browser saving then passed. Both saved files match the Chromium duration/size/codec results and pass full decode with the popup closed. This is Helium download-engine evidence, not a completed signed-in page-discovery check. Report: `test-results/helium-seeded/results.json`.

## YouTube refusal diagnosis — October 6, 2026

The reported video played in the signed-in Helium tab. A separate unsigned Chromium session also played it, with `playabilityStatus: OK`, while its web player response exposed SABR and adaptive-format metadata without downloadable URLs. The original extension produced no card in that clean session. The user's signed-in screenshot instead showed one source refused during inspection; that exact session's failed source URL was not captured, so its specific refusal mechanism is not established.

Version 0.1.9 labels SABR-only and cipher-only playback as unavailable, allows late resolved sources to restore inspection, and reports YouTube HTTP refusals without promising a sign-in/rescan remedy. Rescan clears old card errors. A live retest of the supplied video showed its title and the explicit unsupported-playback message. SABR and signature deciphering remain unsupported.

Validation passed: 31 unit checks, five YouTube browser regressions, nine error/retry/context checks, and 18 download/progress checks in Chromium. The five YouTube cases cover watch/Shorts grouping, SABR-only playback with a late usable source, cipher-only playback, and a real HTTP refusal through the offscreen engine. The refusal fixture uses a local server and a host mapping confined to the disposable browser profile.

The disposable Helium run did not complete: its first controlled page yielded no detected sources, and a later launch aborted navigation with `ERR_ABORTED`. Version 0.1.9 therefore remains a local build with Helium acceptance pending. The user's normal Helium profile and separately installed extension were not changed.

Separately, the Mac's existing `yt-dlp` downloaded the supplied full video without browser cookies. The merged 1920×1080 H.264/AAC MP4 is 312.819 seconds and 27,711,668 bytes, and passed complete FFmpeg decoding. That file is a successful external-tool workaround, not evidence of extension download support. An experimental browser-only alternate-player request did not pass validation and was not added to the extension.

## Repository relocation check — October 4, 2026

From the new iCloud Drive checkout, a fresh `npm ci`, production build, and fixture generation succeeded. All 28 unit checks, 18 download/progress checks, and five non-media browser checks passed (51 total). Generated output was removed afterward with `npm run clean`.

## Covered behavior

- URL validation, signed-URL preservation, site identity/grouping, filename safety, source normalization, and error redaction.
- Complete direct MP4, HLS, static DASH, separate-track merging, and original AAC extraction. Completed synthetic outputs pass ffprobe inspection and full FFmpeg decode.
- Cookie/Referer-authenticated synthetic requests, compressed HLS playlists, transient retries, permanent refusals, and handled terminal errors.
- Determinate and unknown-size progress, popup closure/reopening, cancellation, and a progress DOM element retained across refreshes.
- YouTube watch/Shorts grouping and previews; Vimeo's 21-source grouping case, late metadata, separate embedded videos, and dropdown layout.
- Pinned toolbar activity, visible source indicator assets, popup-closed animation, and immediate cancellation while engine cleanup is deliberately delayed. Late progress does not restart animation; the engine remains reserved until cleanup completes.
- Non-media HTML, empty pages, SVG/XML documents, page updates, repeated rescans, extension reloads, and disconnected contexts.

The 0.1.8 fix passed 28 unit checks, five non-media browser checks in Chromium and five in Helium, and five rescan/reload checks in Chromium. Its packaged extension passed the five non-media checks again. Earlier 0.1.7 checks covered all 18 download/progress cases and five pinned-toolbar cases in each browser. These are distinct observed runs, not a claim that every suite was repeated for each release.

## Real-site observations and limits

| Site | Observed result |
| --- | --- |
| Instagram | A public carousel exposed four individual clips. Complete 720p and 360p video downloads with audio passed full decode checks; the lower-quality case merged separate tracks. |
| Substack | A public replay exposed 480p/270p video choices and a complete verified 90-minute AAC audio download. The full long video was not tested. |
| Vimeo | The supplied unlisted sample displayed one card with its preview and qualities from 240p through 2160p, plus AAC audio. Removing byte ranges from compressed playlist requests fixed a reproduced decoding failure. A transfer started and was deliberately cancelled; the complete 56-minute video was not tested. |
| YouTube | Version 0.1.10 saved the reported unlisted SABR-page video at 1080p with audio and as AAC audio-only, with full decode verification in Chromium. Grouping and fallback failures pass controlled regressions. General SABR decoding, signature deciphering, account-only/verification-gated fallback, and live recording remain unsupported. |
| TikTok | The supplied short-drama sample returned a site error, so its download remains unverified. Decorative player assets are excluded from discovery. |
| Non-media login page | The reported extension-context error did not recur on the supplied public login page. A targeted test reproduced a remaining unguarded reply path and verifies its fix; that does not establish the exact cause of the original visit. No sign-in was performed. |

Private/signed-in real-site acceptance remains separate from the synthetic session/Referer test. DRM, live recording, transcoding, and batch downloads are outside scope. Browser API animation checks do not replace visual acceptance on every desktop platform.
