# Video Toolbox (local-first MVP)

A static, privacy-first video toolbox built with Vanilla JavaScript, Vite, and FFmpeg WebAssembly. Video bytes are processed in the browser; this project does not include a video upload server, database, login, or analytics.

## Included in this starter

- Video Compressor: H.264 MP4 output with smaller, balanced, and higher-quality presets.
- Format Converter: MP4 (H.264 + AAC), WebM (VP8 + Opus), and MOV (H.264 + AAC) output options.
- Video Resizer: original, 480p, 720p, and 1080p output heights with aspect ratio preserved.
- Video Trimmer: start/end time controls.
- Extract Audio: MP3 output.
- Mute Video: remove the audio stream.
- Local file preview, basic metadata, progress display, cancellation, download links, and temporary-file cleanup.

## Requirements

- Node.js 20.19+ or 22.12+ recommended for current Vite releases.
- npm.
- A modern browser with WebAssembly and Web Workers.
- Internet access for npm install and for loading the pinned FFmpeg core from jsDelivr the first time you process a video.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Select a short test video and run the Compressor first.

Run the unit tests (command generation, error classification, formatting) with:

```bash
npm test
```

Note: `vite.config.js` excludes `@ffmpeg/ffmpeg` and `@ffmpeg/util` from Vite's dependency pre-bundling. Without that, the FFmpeg worker fails to start under `npm run dev` and the app waits forever on "Downloading the local processing engine…".

## Production build

```bash
npm run build
npm run preview
```

The static production bundle is written to `dist/`.

## Deploy on Netlify

1. Create a new GitHub repository and push this folder.
2. In Netlify, import the repository.
3. Build command: `npm run build`.
4. Publish directory: `dist`.
5. Deploy. No environment variables are required for this version.

The included `netlify.toml` configures the build and a small set of response headers.

## Important limitations to test before a public launch

- Browser codec support, available memory, and FFmpeg WebAssembly performance vary. Start testing with short, small videos and warn users before processing large files.
- The 480p/720p/1080p options set the output video height while preserving aspect ratio. On portrait videos, the width remains narrow. Upscaling changes dimensions but does not restore lost detail.
- FFmpeg progress events are experimental and may not produce a reliable percentage for every operation.
- If a codec is not present in the pinned core build or an input is damaged/unsupported, the job will fail. The UI reports an error; test target browsers and codecs before claiming universal support.
- The first processing attempt downloads the FFmpeg core: a ~32 MB WebAssembly binary plus a ~110 KB JavaScript loader. These assets are served by jsDelivr, so the app itself does not upload source videos, but that CDN request is still a third-party network request. The downloaded core is cached for the rest of the page session, so cancelling a job or recovering from an error does not download it again.
- The core is pinned to `@ffmpeg/core@0.12.10`, whose package is GPL-2.0-or-later. Review FFmpeg and bundled codec licensing, and provide applicable notices/source information before public distribution. Do not assume every possible FFmpeg build or codec has the same license.
- WebM output uses VP8 + Opus. `libvpx-vp9` is present in this single-threaded core build but crashes the engine ("memory access out of bounds") on every option set that was tried, so VP9 should only be reintroduced after testing a different core version.
- Compress uses the x264 `veryfast` preset because `ultrafast` produced files ~2.7x larger at the same quality on a test clip. Other tools use `superfast`. Expect roughly real-time encoding speed or slower for 720p in WebAssembly; measure on target devices.
- Files over 250 MB show an advisory warning. The app keeps the input and output in memory, so very large files can exhaust browser memory; this MVP intentionally has no server-side fallback. After any failed job, and after jobs on files over 64 MB, the engine is restarted so its memory is released.
- Trim seeks on the input side and re-encodes, so cuts are frame-accurate but not instant.
- Security headers are set in `netlify.toml`. A Content-Security-Policy that limits `connect-src` to `'self'` and the core CDN would back up the "your video never leaves this tab" promise, but it needs `blob:` workers and `wasm-unsafe-eval` and should be tested in Safari and Firefox before it ships.

## Next engineering tasks

1. Test real MP4/MOV/WebM samples in Chrome, Firefox, Safari, and mobile browsers.
2. Add browser-level tests (the audit used headless Chromium with the real core; see AUDIT.md) to CI.
3. Improve metadata probing for formats the browser cannot preview (e.g. read duration with FFmpeg so trim validation works for HEVC/MKV).
4. Add a configurable file-size warning based on device testing.
5. Add more tools only after the current six workflows are verified.

## License

The application source written for this starter is provided under the MIT License (see `LICENSE`). Third-party dependencies and FFmpeg core retain their own licenses.
