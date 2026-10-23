# Audit notes

The starter was audited by reading every file and by running the built app in headless Chromium against the real
`@ffmpeg/core@0.12.10`, with the test clips below. The same 30-step browser run passes on both `npm run dev` and
the production build; `npm test` has 22 unit tests.

## Bugs fixed

| # | Problem | Evidence | Fix |
|---|---------|----------|-----|
| 1 | `npm run dev` never loaded the engine: Vite pre-bundled `@ffmpeg/ffmpeg` and its worker URL broke (`worker.js … ERR_FAILED`). The UI sat on "Downloading the local processing engine…" forever. | Reproduced in dev, passes in prod build | `optimizeDeps.exclude` in `vite.config.js`; engine start now has a 60 s timeout and a clear error |
| 2 | **WebM conversion crashed the engine.** `libvpx-vp9` hits `memory access out of bounds` in this core with every option set tried; the engine was then unusable until reload, so *every later job failed too*. | 7 VP9 variants crash, VP8/Opus work | WebM is VP8 + Opus; the engine is restarted after any failed job |
| 3 | Every failure showed the generic "could not be processed" message: FFmpeg.wasm rejects with plain strings, so `error.message` was `undefined`. | Logged `typeof error === 'string'` | New `lib/errors.js` normalises errors and reads FFmpeg's log to explain the failure (no audio track, damaged file, out of memory, …) |
| 4 | Odd-sized sources (e.g. 641×361) failed with "Keep original" (`width not divisible by 2`). | Reproduced with a lossless MKV | A rounding scale filter is always applied |
| 5 | Selected options (resolution, quality, format, trim times) reset to defaults whenever the page re-rendered: when metadata loaded, and when a job started or finished. "Process again" silently used defaults. | Reproduced | Options live in `state.options`; the preview `<video>` element is kept across renders |
| 6 | Cancel race: cancelling then starting a new job let the old job's `finally` clear the new job's handlers and flip `busy` off; the raw "called FFmpeg.terminate()" error could overwrite the cancel message. | Code analysis; cancel-during-download test passes now | Per-job tokens in both the client and the UI; cancelled jobs are silent; a distinct "Job cancelled" state |
| 7 | A failed or cancelled engine load could null out a newer engine and leaked its worker; the 32 MB core was re-downloaded after every reset. | Code analysis | Generation counter; workers terminated; core blob URLs cached for the session |
| 8 | Compress could make files **larger**: `-preset ultrafast` gave 7.1 MB vs 2.6 MB for `veryfast` on the same 8 s clip (source: 3.1 MB). | Benchmark in the core | Compress uses `veryfast` (~2.4× slower encode); other tools `superfast` |
| 9 | Trim used output-side `-ss`, which decodes everything before the start point (very slow in WebAssembly); `-t` could be `7.199999999999999`. | Code analysis | Input-side `-ss`/`-t` (still frame-accurate, re-encoded), rounded to ms |
| 10 | Large-file warning was 500 MB and a 3.5 s toast; the plan says 250 MB advisory. | Plan §6 | 250 MB, persistent notice in the source panel |
| 11 | Dimensions showed "Detecting…" forever when the browser could not preview the codec (e.g. HEVC MOV). | Reproduced | Shows "Unavailable" |
| 12 | Extra memory copy of the whole output (`bytes.slice().buffer`); MOV downloads were typed `video/mp4`. | Code analysis | Blob built from the bytes directly; correct MIME types |
| 13 | Most secondary text failed WCAG AA contrast (as low as 1.9:1) and a lot of text was 8–10 px. | Measured every `color:` | Failing colors darkened (hue kept), tiny sizes raised ~2 px; layout checked at 1280 px and 390 px |
| 14 | Smaller items: dropping a file while busy showed "Choose a supported video file"; leaving the page mid-job lost the work silently; no favicon; hashed assets had no long-lived cache header; `formatBytes` could print "1000 KB"; the README misdescribed the core download (the JS loader is ~110 KB, the WASM is ~32 MB). | Code analysis | Fixed; `engines` field and `package-lock.json` added |

## Not changed (your call)

- Resolution presets set the output **height**, so a portrait video at "720p" becomes ~405×720. This matches the README and
  the original behaviour; many tools size by the shorter side instead.
- No Content-Security-Policy (see README) and no cross-browser run: only Chromium was available here, and it has no H.264
  decoder, so the in-page preview of MP4 files was not exercised. Test Chrome/Edge, Firefox, Safari and a real phone.
- jsDelivr is still a single point of failure for the core; self-hosting it on Netlify is the alternative in the plan.
