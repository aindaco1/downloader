# Validation

Last source changes: version 0.1.16, November 7, 2026. These observations describe tested behavior, not universal support for a website. Generated reports, profiles, recordings, and old builds are intentionally excluded from this repository.

## YouTube higher resolutions — November 7, 2026

Version 0.1.16 supplements the made-for-kids Android fallback with a TVHTML5 Samsung lookup using the current anonymous watch-page signature timestamp. The matching open YouTube frame prepares the returned URLs using its already-loaded URL wrapper. The extension neither fetches nor evaluates player JavaScript. Renamed exports/methods are recognized by their narrow prototype shape, ambiguity fails closed, page/video/timestamp mismatches are rejected, and the worker accepts changes only to the media URL's `n` parameter. The successful combined Android stream remains available if the optional path fails. There are no new permissions or dependencies.

The reported film passed real quality inspection in disposable Chromium 156 on the final 0.1.16 build: **3840 × 1634 VP9**, **2560 × 1088 VP9**, **1920 × 816 H.264**, **1280 × 544 H.264**, **854 × 364 H.264**, and **640 × 272 H.264**, all paired with AAC audio. These are source dimensions, without upscaling. Inspection read actual encoded media packets. A separate 64 KiB media range reproduced HTTP 403 before URL preparation and HTTP 206 afterward. No full-film download was attempted on hotel Wi-Fi; the live harness pauses playback after discovery and ran with `INSPECT_ONLY=1`. Evidence: `test-results/youtube-highres-final-live/results.json`, `qualities.png`, and `outputs/youtube-highres/`.

All 67 unit checks pass, including renamed page exports, wrong pages/timestamps, ambiguous/missing processors, signed URL preservation, high-quality/default-audio selection, and preservation of the working fallback after optional HTTP/account/protected/mismatched responses. This path depends on the site's current loaded player and public client behavior; standalone script execution, general SABR decoding, and account-only playback remain unsupported.

Six controlled browser cases passed in Chromium 156, including the actual MAIN-world URL preparation, 4K/1080p quality inspection, fallback when the page processor is missing, matched anonymous client headers, refusal handling, and temporary-rule cleanup. A complete six-second synthetic 3840 × 1634 VP9 + AAC MP4 was saved with the popup closed and fully decoded with FFmpeg. Evidence: `test-results/youtube-highres-clients-final/results.json`. An initial high-resolution fixture used a 12-character mock video ID; correcting it to YouTube's 11-character format fixed the fixture's detection failure. A Helium controlled run passed its initial inspection/save cases but then aborted local-page navigation (`ERR_ABORTED`); it is not counted as the complete browser-suite pass.

The existing installation was backed up to `~/Documents/dust-wave-downloader/extension-backup-0.1.15-20261107-161929`, replaced with 71 byte-identical build files, and reloaded. Helium visibly confirmed **0.1.16** and **Reloaded**. Identity, permissions, and CSP are unchanged. A final rebuild preserved every tested runtime file and removed five unreferenced iCloud duplicate chunk files. Evidence: `outputs/youtube-highres/install.json`. Refresh the YouTube page to replace its previous detector and cached quality list.

## YouTube made-for-kids client fallback — November 7, 2026

The supplied unlisted, finite 5,394-second video plays anonymously in the web player and is explicitly marked made for kids by its miniplayer response. The existing VISIONOS 1.02 lookup returned HTTP 200 with matching video metadata, `UNPLAYABLE`, and no streams, reproducing the reported error. The [upstream client definitions](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py) document that VISIONOS cannot serve made-for-kids uploads. A bounded Android 21.26.364 probe returned a readable combined MP4; iOS supplied SABR only, and the tested web/TV alternatives did not return usable streams.

Version 0.1.15 makes one additional anonymous Android lookup only after a matching VISIONOS unavailable response, excluding live and protected responses. It retains the same visitor context and total lookup deadline, updates the temporary player-request User-Agent for the chosen client, and keeps account requirements, HTTP failures, identity mismatches, and repeated unavailability terminal. The returned clear media uses the existing bounded YouTube reads, inspection, local remuxing, progress, and cancellation.

All 63 unit tests and four focused client/browser cases passed. In Helium 157, the controlled browser verifies the real two-client lookup flow, matching request headers, anonymous requests, one card, H.264/AAC quality inspection, a complete saved video with the popup closed and full decode, primary-client success without an extra lookup, terminal account/HTTP failures, preserved sources, and request-rule cleanup. Evidence: `test-results/youtube-client-regression/results.json` and `test-results/youtube-hoffman-unit.log`.

The real supplied video passed detection and quality inspection in Chromium 156: **640 × 272 H.264 video with AAC audio**, plus AAC-only extraction. The full-film test was stopped when the user requested avoiding slow downloads on hotel Wi-Fi, so it is not reported as a completed saved-file check. The readable source advertised 141,485,834 bytes; a bounded 64 KiB range returned HTTP 206 without authentication or a special media User-Agent. Evidence: `test-results/youtube-hoffman-live/qualities.png`, `outputs/youtube-hoffman/android-ios-results.json`, and `outputs/youtube-hoffman/live-test-stopped.json`. No full-film test will be restarted on this connection.

The existing Helium installation was updated from 0.1.14 to 0.1.15 with 71 byte-identical build files and unchanged identity/permissions. Helium visibly confirmed **0.1.15** and **Reloaded**. The previous build is retained at `~/Documents/dust-wave-downloader/extension-backup-0.1.14-20261107-160106`; the earlier 0.1.13 rollback also remains. Signed-in quality inspection of the final YouTube change was not repeated while the user was browsing; real-link inspection evidence above is from the disposable Chromium profile. The final combined build also passed all four Drive browser cases (`test-results/drive-0.1.15/results.json`).

## Google Drive original files — November 7, 2026

Version 0.1.14 detects original video/audio files from the individual Drive viewer's metadata, with matching file identity and a viewer-provided download link. It preserves the selected Google account and shared-link resource key. Inspection reads one byte and offers **Original file**; saving streams the original bytes through the existing disk-backed pipeline. MOV and other supported media suffixes are retained without remuxing. Drive's large-file scan-limit confirmation is validated once, and its notice appears before Download. Sign-in HTML, permission/quota refusals, CAPTCHA, and flagged-file warnings are not saved as media or bypassed. The temporary confirmation token stays within the operation. Active original transfers use an idle deadline so files can take more than 90 seconds. There are no new permissions or dependencies.

All 61 unit tests, four Drive browser cases, and four X browser cases passed in disposable Helium 157. All 18 general download/progress checks passed in Chromium 156. The browser check saves a cookie/Referer-protected MOV byte for byte through the real popup, with the popup closed, verifies full FFmpeg decode, and checks single-card rescans, account/resource-key preservation, transient confirmation tokens, permission/CAPTCHA failures, missing download links, byte progress, cancellation, and request-rule cleanup. Evidence: `test-results/drive-reviewed-final/results.json`, `drive-original-choice.png`, and `test-results/drive-unit-final.log`. Reports also include `test-results/drive-twitter-regression/results.json` and `test-results/drive-generic-chromium/browser-results.json`. The general suite first passed its direct-file case in Helium, then its next local-page navigation was aborted (`ERR_ABORTED`); the Chromium run completed all 18 cases. The harness accepts an explicit Chromium executable and separate report directory. The initial Drive implementation also passed its four browser cases before the idle-timeout review fix.

The supplied 1,316,746,153-byte MOV passed signed-in discovery, one-byte inspection, and a sustained transfer reaching approximately 840 MB (63%). The user then identified the connection as hotel Wi-Fi and authorized stopping slow downloads. Cancellation was requested, and the browser toolbar returned to idle. A full saved-file decode of this private MOV was therefore not completed; exact-byte save and full decode are verified by the controlled browser fixture. Helium visibly confirmed version 0.1.14 and Reloaded; the refreshed Drive page shows one card and **Original file · MOV · 1.3 GB**. The previous installed extension is retained at `~/Documents/dust-wave-downloader/extension-backup-0.1.13-20261107-153625`. Identity and permissions are unchanged.

This support covers individual Drive video/audio originals with download access. Preview renditions, audio extraction from a Drive video, folders, and Google Workspace document exports are outside scope. Detection depends on Drive's current viewer metadata, and confirmation recognition currently uses its English scan-limit warning. General sharing/access restrictions remain enforced by Google.

## Reproduce locally

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run fixtures
npm run test:browser
npm run test:youtube
npm run test:youtube-clients
npm run test:vimeo
npm run test:twitter
npm run test:drive
npm run test:substack
npm run test:errors
npm run test:rescan
npm run test:toolbar
npm run test:nonmedia
```

Browser checks use disposable profiles and generated media. Install FFmpeg and ffprobe on the development machine to generate fixtures and independently inspect/decode completed files. The extension itself needs neither program. Reports and downloaded files are written under `test-results/`. Use `npm run clean` to remove reproducible output afterward.

The YouTube, rescan, toolbar, and non-media harnesses accept `CHROMIUM_EXECUTABLE`, `EXTENSION_DIR`, and `RESULTS_DIR` overrides. Helium was also tested on macOS. Windows and Linux still need native acceptance testing.

## X.com duplicate video cards — November 7, 2026

The reported Apple TV post (`2118086064502170057`) uses media ID `amplify_video/2118079583056740352`. Its official master playlist contains four video qualities and three audio renditions. Previously, discovery keyed each complete URL separately. The player also requests video/audio initialization MP4s from its HLS `EXT-X-MAP` entries; these are not independently playable files. A first live signed-in check of playlist grouping alone still showed two extra audio initialization cards, which established the need to exclude those fragments as well.

Version 0.1.13 groups recognized `video.twimg.com` variants by media namespace and ID, retaining original source URLs and the first card's ID. Different videos, unrelated hosts, and unknown paths stay separate. New detection also collapses cached duplicates. Known X HLS initialization MP4 paths are excluded by both network classification and source normalization, including explicitly typed sources. The download engine, permissions, and dependencies are unchanged.

The new unit regression reproduced eight cards before the fix. All 53 unit checks and the build pass. The controlled browser harness exercises actual network discovery, one visible card for eight playlists plus four initialization MP4 requests, repeated requests/rescan, both synthetic video qualities and original audio, a complete 640×360 H.264/AAC save with the popup closed, full FFmpeg decoding, and a second clip staying separate. Browser evidence and installation results are recorded below.

The final build passed all four focused browser cases in disposable Helium 157. Evidence: `test-results/twitter-helium-final-acceptance/results.json` and `one-card.png`. Earlier harness attempts encountered navigation restarts and stale button labels; the final fixture retains its selected media across automatic reloads and uses the actual popup controls. The complete synthetic output is 6.037333 seconds with H.264 video and AAC audio, and passed full decode.

The installed extension at `~/Documents/dust-wave-downloader/extension` was updated and reloaded; Helium visibly confirmed version **0.1.13** and **Reloaded** after the final fragment exclusion. The original 0.1.12 build is retained at `~/Documents/dust-wave-downloader/extension-backup-0.1.12-20261107-151355`. Extension identity and permissions remain unchanged. The signed-in page exposed the initialization-file issue during the intermediate build. Final one-card UI/download acceptance is from the controlled browser test; the normal X tab still needs a refresh, and final signed-in one-card acceptance was not completed while the user was interacting with the browser. No additional real clip was downloaded into the normal profile.

The older YouTube browser harness failed its late-title check in Chromium 156 on both the pre-change and updated code. Vimeo browser checks were also unstable in Helium 157: the updated run reached two separate embedded cards but missed an observed source; the pre-change run failed earlier on preview loading. These suites are not reported as passing. Their unit grouping coverage passes. The installed Playwright version's default Chromium executable was absent; browser runs used explicit paths to available Chromium/Helium binaries. An unsigned live X attempt returned `ERR_HTTP_RESPONSE_CODE_FAILURE`; signed-in verification uses the user's normal Helium UI instead.

## Download inspection and cancellation errors — October 8, 2026

The reported episode's public lookup produced 24 retained streams, including repeated video codecs and automatic dubs. Sequential inspection exhausted its 45-second deadline before reaching a usable video/audio pair. Its direct media URLs did respond successfully; the earlier failed attempts did not establish a blanket provider refusal. The generic error formatter also mislabeled any abort/cancel wording as “Cancelled,” even without a user cancellation. The exact underlying error from the user's screenshot was not captured; repeated narration inspection and saving succeeded during diagnosis.

Version 0.1.12 keeps one compatible stream per resolution/frame rate, preferring H.264 when available, and one default audio stream, preferring AAC. Resolutions available only in another codec and audio without AAC remain supported. The episode now offers six video qualities (144p–1080p) and English AAC audio from seven sources. Explicit cancellation carries its own code; transport aborts and timeouts remain errors with actionable messages. YouTube's open-ended file reads are capped at 10 MiB, with Mediabunny continuing from Content-Range; this avoids the sharp throughput slowdown observed during the first 1080p transfer. Signed URLs and already-bounded requests remain unchanged. No permission, runtime dependency, or media transcoding was added.

The actual article passed discovery, both preview images, quality inspection, full read-aloud MP3 saving, and full 360p episode saving in disposable Helium 154 using the real popup controls. The 640×360 H.264/AAC MP4 is 3,652.963265 seconds and 156,212,928 bytes; the narration MP3 is 101.472 seconds and 608,832 bytes. Both downloads completed with the popup closed and passed ffprobe inspection plus complete FFmpeg decoding. Rescan retained two cards, and temporary request rules were cleared. Evidence: `test-results/helium-substack-download/download-results.json`. Quality inspection also passed in disposable Chromium 153 (`test-results/substack-fixed-inspection/inspection-results.json`).

The final build also saved the complete default 1920×1080 H.264/AAC episode in Helium: 3,652.963265 seconds, 829,907,868 bytes. Both the episode and narration passed full decode, with the popup closed during saving. Video inspection took 3.38 seconds. Both previews loaded, rescan stayed at two cards, and all temporary request rules were removed. Report: `test-results/helium-substack-final-1080/download-results.json`. Earlier disposable Helium attempts occasionally aborted initial page navigation; the harness now tolerates a bounded same-page navigation restart before asserting detection. The first open-ended 1080p transfer was stopped during diagnosis after its throughput dropped; it was not counted as a successful save.

Validation passed 46 unit checks, 18 download/progress checks (including real cancellation), nine error/context checks, seven YouTube browser checks, four Substack browser checks, and five toolbar/cancellation checks. The new range test compares every original audio byte across multiple HTTP responses. Early toolbar runs failed their detection-pulse timing assertions before reaching cancellation; the installed 0.1.11 baseline and a final unchanged-harness 0.1.12 run both passed all five checks. No toolbar code or harness change was retained. Reports include `test-results/errors-regression`, `test-results/youtube-regression`, `test-results/substack-regression`, and `test-results/toolbar-final-original`.

The existing Helium installation was backed up to `~/Documents/dust-wave-downloader/extension-backup-0.1.11-20261008-195019`, replaced with 279 byte-identical build files, and reloaded. Helium visibly confirmed **0.1.12** and **Reloaded**. The normal signed-in article tab then passed both quality lookups and visibly showed both previews, original MP3 narration, and the default 1920×1080 MP4 with AAC audio, each ready to download without a cancellation error. Extension identity and permissions are unchanged. Full saved-file acceptance used a disposable Helium profile; no duplicate full episode was saved in the normal signed-in profile.

## Substack recommendations and previews — October 8, 2026

The reported [Hollywood Hang article](https://thehollywoodhang.substack.com/p/haley-nicole-johnson-obsession) reproduced six cards with the same title and no images in 0.1.10. Its `/api/v1/archive?sort=top&search=&offset=0&limit=6` response contained six different posts, each with a nested text-to-speech MP3. The generic JSON walker discarded the parent post metadata and attributed every nested audio URL to the open tab. Five tracks belonged to other articles. These were not alternate video qualities.

Version 0.1.11 scopes Substack article JSON to the current permalink, carries the parent title/cover to nested media, labels TTS as “read aloud,” and reads the current article's `_preloads.post` when recommendations are absent. A separate YouTube embed path reads its playable preview metadata, validates the video identity, and offers the existing public player lookup. Narration and podcast video retain separate cards and request contexts. No permission or dependency changed.

Validation passed 43 unit checks, four controlled Substack browser cases, seven YouTube browser cases, and four Vimeo browser cases in Chromium 153. The first concurrent Vimeo run timed out waiting for its 21-source fixture; an unchanged repeat passed all four cases. Substack coverage includes the six-post response, nested previews/titles, bare foreign audio, preload-only discovery, repeated fetch/XHR/rescans, navigation, and a preview-only YouTube iframe with independent lookup and request-rule cleanup. Reports are under `test-results/substack-regression`, `test-results/youtube-regression`, and `test-results/vimeo-regression`.

The real article now shows two cards in disposable Chromium: the current article's read-aloud MP3 and its 1:00:53 YouTube podcast. Both real preview images loaded and rescan retained two cards. `node tests/substack-live.mjs` reproduces this detection check; `INSPECT=1` additionally checks quality inspection as a separate gate. Evidence: `test-results/substack-live/results.json` and `detected.png`.

At the 0.1.11 gate, the read-aloud MP3 passed quality inspection. The podcast's public lookup reached the media engine, but video inspection timed out on one attempt and returned a YouTube stream refusal on a second. Complete episode downloading was unverified in that change; see the 0.1.12 results above for the subsequent download fix. The earlier failed inspection report is retained at `test-results/substack-live/inspection-results.json`.

The existing Helium installation at `~/Documents/dust-wave-downloader/extension` was backed up to the sibling `extension-backup-0.1.10-20261008-184321` folder, updated to byte-identical 0.1.11 build output, and reloaded. Helium visibly confirmed **0.1.11**, **Reloaded**, and **2 media items available** on the supplied article. Preview rendering and quality-inspection evidence above came from disposable Chromium; no signed-in Helium download was performed.

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
