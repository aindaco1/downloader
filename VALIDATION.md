# Validation

Last source changes: version 0.1.8, October 4, 2026. These observations describe tested behavior, not universal support for a website. Generated reports, profiles, recordings, and old builds are intentionally excluded from this repository.

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

The rescan, toolbar, and non-media harnesses accept `CHROMIUM_EXECUTABLE`, `EXTENSION_DIR`, and `RESULTS_DIR` overrides. Helium was also tested on macOS. Windows and Linux still need native acceptance testing.

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
| YouTube | Grouping and previews pass controlled regressions. A live Shorts sample displayed one card and a preview but its server refused inspection in the clean profile. Cipher-only sources and SABR remain unsupported. |
| TikTok | The supplied short-drama sample returned a site error, so its download remains unverified. Decorative player assets are excluded from discovery. |
| Non-media login page | The reported extension-context error did not recur on the supplied public login page. A targeted test reproduced a remaining unguarded reply path and verifies its fix; that does not establish the exact cause of the original visit. No sign-in was performed. |

Private/signed-in real-site acceptance remains separate from the synthetic session/Referer test. DRM, live recording, transcoding, and batch downloads are outside scope. Browser API animation checks do not replace visual acceptance on every desktop platform.
