# Third-party code and reuse

Runtime libraries are bundled locally. Exact resolved versions are recorded in `package-lock.json`. Full license text is in `extension/THIRD_PARTY_NOTICES.txt`; matching installed package source is in `third-party-source/`.

| Package | Version | License |
| --- | --- | --- |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | 1.61.0 | MPL-2.0 |
| [mpd-parser](https://github.com/videojs/mpd-parser) | 1.4.0 | Apache-2.0 |
| @babel/runtime | 7.29.7 | MIT |
| @videojs/vhs-utils | 4.1.2 | MIT |
| @xmldom/xmldom | 0.8.15 | MIT |
| global | 4.4.0 | MIT |
| min-document | 2.19.2 | MIT |
| dom-walk | 0.1.2 | MIT |
| process | 0.11.10 | MIT |

The Mediabunny source files were not modified. esbuild bundles and minifies selected exports. Its source archive includes the MPL license and original source. Other listed packages are included conservatively even where tree shaking removes their browser-unused paths. Development tools and type-only dependencies are not part of the runtime extension.

## Reviewed references

- `digest-link-clipper`, commit `34d7cf8047054f41fbf127e917cf5d08e84d33a0`: plain-JavaScript MV3 structure, current-tab interaction, status/keyboard flow, manual installation patterns.
- `dust-wave-platform`, commit `0f84a675deb9577648b35ae0fd0ebed5e9abcb60`: reviewed shared media, design, build, and test seams. No suitable downloader engine was present. No artificial platform dependency was added; no shared repository was changed.
- [TheKonka Instagram extension](https://github.com/TheKonka/instagram-download-browser-extension/tree/475e7ead491f6e7e71275079958346986c8d88b9), MIT: Instagram response and media-field reference.
- [DoctorLai Simple Video Download Helper](https://github.com/DoctorLai/VideoDownloadHelper/tree/20b56939c2f39c2fdf54c377eea7d375fb9dbf08), MIT: generic HTML/Open Graph discovery reference. Its remote parsing API is outside this project.
- [MediaGrabber](https://github.com/miroshArtem/MediaGrabber/tree/daf968e2f9ad853b318a10196f0e21c586798db5), MIT: discovery/format-picker reference. Its companion architecture is outside scope.

No code from those three extension repositories was copied into this build. Their designs informed the small original adapters. The supplied screenshot guided the dark card layout; its premium offer/countdown were reference content, not requested features.

## Icon artwork

Version 0.1.1 uses newly generated download-arrow artwork inspired by the cyan/magenta pixel treatment of the local ASCII VJ REMIX icon. The reference project was not changed. The new artwork is included in `assets/downloader-icon.png`; `scripts/icons.mjs` produces its app sizes and static animation frames.
