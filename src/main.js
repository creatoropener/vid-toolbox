import './styles.css';
import { cancelProcessing, isEngineLoaded, runFFmpeg } from './lib/ffmpeg-client.js';
import { errorText, isCancelled } from './lib/errors.js';
import { extensionOf, formatBytes, formatDuration, safeBaseName } from './lib/format.js';
import { buildArguments, buildInputArguments, outputDetails } from './tools/operations.js';

const app = document.querySelector('#app');

// The plan suggests an advisory (not a hard) warning above 250 MB; tune it with real-device testing.
const LARGE_FILE_BYTES = 250 * 1000 * 1000;
const VIDEO_NAME_PATTERN = /\.(mkv|avi|mov|webm|m4v|mp4|3gp)$/i;

const TOOL_CARDS = [
  { id: 'compress', title: 'Compress video', description: 'Reduce file size without leaving your browser.', icon: '⇣' },
  { id: 'convert', title: 'Convert format', description: 'Export a video as MP4, WebM, or MOV.', icon: '↔' },
  { id: 'resize', title: 'Resize video', description: 'Switch between 480p, 720p, 1080p, or original.', icon: '◫' },
  { id: 'trim', title: 'Trim video', description: 'Keep only the clip you need.', icon: '⌁' },
  { id: 'audio', title: 'Extract audio', description: 'Save a video’s soundtrack as MP3.', icon: '♫' },
  { id: 'mute', title: 'Mute video', description: 'Remove the audio track and keep the picture.', icon: '⊘' },
];

const state = {
  tool: 'compress',
  file: null,
  inputUrl: null,
  outputUrl: null,
  output: null,
  metadata: { duration: null, width: null, height: null },
  // Option values live here, not in the DOM: render() rebuilds the page, which used to reset every
  // select and text field to its default whenever metadata loaded or a job started/finished.
  options: { resolution: 'original', quality: 'balanced', format: 'mp4', start: '0', end: '' },
  busy: false,
  loading: false,
  cancelled: false,
  progress: null,
  status: 'Choose a video to begin.',
  error: '',
  warning: '',
  log: '',
};

// Identifies the current job so a cancelled job that finishes unwinding late cannot overwrite the UI.
let jobToken = 0;

const ICONS = {
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.9 8.2-7 10-4.1-1.8-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M5 14v5h14v-5"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m-4-4 4 4 4-4"/><path d="M5 18v2h14v-2"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function currentTool() {
  return TOOL_CARDS.find((item) => item.id === state.tool) || TOOL_CARDS[0];
}

function selectMarkup(id, key, choices) {
  return `<select id="${id}" class="select-control" data-option="${key}">${choices
    .map(([value, text]) => `<option value="${value}" ${state.options[key] === value ? 'selected' : ''}>${text}</option>`)
    .join('')}</select>`;
}

function toolOptionsMarkup() {
  const resolution = `
    <label class="field-label" for="resolution">Output resolution</label>
    ${selectMarkup('resolution', 'resolution', [
      ['original', 'Keep original'],
      ['480p', '480p · Standard definition'],
      ['720p', '720p · HD'],
      ['1080p', '1080p · Full HD'],
    ])}
    <p class="field-help">Aspect ratio is preserved. Upscaling increases dimensions but cannot restore detail that is not in the source.</p>`;
  const quality = `
    <label class="field-label" for="quality">Encoding quality</label>
    ${selectMarkup('quality', 'quality', [
      ['smaller', 'Smaller file'],
      ['balanced', 'Balanced · Recommended'],
      ['quality', 'Higher quality'],
    ])}`;

  if (state.tool === 'compress') return `${resolution}${quality}<div class="hint-card"><span class="hint-dot"></span><p>Compression depends on the source. Some videos may not become smaller at every setting.</p></div>`;
  if (state.tool === 'resize') return `${resolution}${quality}`;
  if (state.tool === 'convert') return `
    <label class="field-label" for="format">Output format</label>
    ${selectMarkup('format', 'format', [
      ['mp4', 'MP4 · H.264 + AAC'],
      ['webm', 'WebM · VP8 + Opus'],
      ['mov', 'MOV · H.264 + AAC'],
    ])}${resolution}${quality}`;
  if (state.tool === 'trim') return `
    <div class="field-grid">
      <div><label class="field-label" for="trim-start">Start time (seconds)</label><input class="text-control" id="trim-start" data-option="start" type="number" min="0" step="0.1" value="${escapeHtml(state.options.start)}" /></div>
      <div><label class="field-label" for="trim-end">End time (seconds)</label><input class="text-control" id="trim-end" data-option="end" type="number" min="0.1" step="0.1" placeholder="e.g. 15" value="${escapeHtml(state.options.end)}" /></div>
    </div>${quality}<p class="field-help">The end time must be greater than the start time. Accurate trimming re-encodes the selected segment.</p>`;
  if (state.tool === 'mute') return `${resolution}${quality}<p class="field-help">The output keeps the video and removes its audio track.</p>`;
  return `<p class="field-help">The soundtrack will be exported as an MP3 file. This feature requires an audio track in the source.</p>`;
}

function render() {
  const tool = currentTool();
  const previousVideo = document.querySelector('#source-preview');
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#home" aria-label="Video Toolbox home">
          <span class="brand-mark">V</span><span class="brand-copy"><strong>video<span>toolbox</span></strong><small>Simple tools. Private by design.</small></span>
        </a>
        <div class="topbar-note">${ICONS.shield}<span>Files stay on your device</span></div>
      </header>

      <main class="page-layout">
        <aside class="sidebar">
          <div class="sidebar-heading">YOUR TOOLBOX</div>
          <nav class="tool-nav" aria-label="Video tools">
            ${TOOL_CARDS.map((item) => `<button class="nav-item ${state.tool === item.id ? 'active' : ''}" data-tool="${item.id}" ${state.busy ? 'disabled' : ''}><span class="nav-icon">${item.icon}</span><span>${escapeHtml(item.title)}</span>${state.tool === item.id ? '<span class="nav-active-dot"></span>' : ''}</button>`).join('')}
          </nav>
          <div class="privacy-card"><div class="privacy-icon">${ICONS.shield}</div><strong>Private by design</strong><p>Video processing happens in your browser. Your video is not uploaded to our server.</p><span class="privacy-status"><i></i> Local processing</span></div>
          <div class="sidebar-footer">No account needed · No uploads</div>
        </aside>

        <section class="workspace">
          <div class="page-heading">
            <div><div class="eyebrow">VIDEO TOOLS / <span>${escapeHtml(tool.title.toUpperCase())}</span></div><h1>${escapeHtml(tool.title)}</h1><p>${escapeHtml(tool.description)}</p></div>
            <div class="local-badge">${ICONS.shield}<span>100% in-browser</span></div>
          </div>

          <div class="work-grid">
            <section class="panel source-panel" aria-label="Choose video">
              <div class="panel-heading"><div><span class="step-number">01</span><h2>Choose a video</h2></div><span class="panel-mini-label">SOURCE FILE</span></div>
              <div id="drop-zone" class="drop-zone ${state.file ? 'has-file' : ''}" tabindex="0" role="button" aria-label="Choose a video file">
                ${state.file ? `
                  <div class="selected-file-icon">${ICONS.video}</div>
                  <div class="selected-file-info"><strong title="${escapeHtml(state.file.name)}">${escapeHtml(state.file.name)}</strong><span>${formatBytes(state.file.size)}${state.metadata.duration != null ? ` · ${formatDuration(state.metadata.duration)}` : ''}</span></div>
                  <button class="icon-button remove-file" id="remove-file" aria-label="Remove selected file" ${state.busy ? 'disabled' : ''}>${ICONS.close}</button>
                ` : `
                  <div class="upload-illustration">${ICONS.upload}<span class="upload-spark spark-one">✦</span><span class="upload-spark spark-two">✧</span></div>
                  <strong>Drop your video here</strong><span class="drop-subtitle">or click to browse your device</span>
                  <span class="file-types">MP4 · MOV · WEBM · MKV · AVI · M4V</span>
                `}
                <input type="file" id="file-input" accept="video/*,.mkv,.avi,.mov,.webm,.m4v,.mp4,.3gp" hidden ${state.busy ? 'disabled' : ''}/>
              </div>
              ${state.file ? `
                <div class="metadata-grid">
                  <div class="metadata-item"><span>File size</span><strong>${formatBytes(state.file.size)}</strong></div>
                  <div class="metadata-item"><span>Dimensions</span><strong>${state.metadata.width && state.metadata.height ? `${state.metadata.width} × ${state.metadata.height}` : state.metadata.previewError ? 'Unavailable' : 'Detecting…'}</strong></div>
                  <div class="metadata-item"><span>Duration</span><strong>${formatDuration(state.metadata.duration)}</strong></div>
                </div>
                ${state.metadata.previewError ? '<p class="field-help">Preview is unavailable for this codec. You can still try processing the file.</p>' : ''}
                ${state.warning ? `<p class="field-help warning" role="status">${escapeHtml(state.warning)}</p>` : ''}
                <video class="source-preview" id="source-preview" controls playsinline preload="metadata"></video>
              ` : `<div class="source-footnote"><span class="tiny-lock">${ICONS.shield}</span> Your video never leaves this browser tab.</div>`}
            </section>

            <section class="panel settings-panel" aria-label="Processing settings">
              <div class="panel-heading"><div><span class="step-number">02</span><h2>Set your options</h2></div><span class="panel-mini-label">CUSTOMIZE</span></div>
              <div class="settings-content">${toolOptionsMarkup()}</div>
              <div class="action-area">
                <button class="primary-button" id="start-button" ${!state.file || state.busy ? 'disabled' : ''}>${state.busy ? '<span class="button-spinner"></span> Processing…' : `${ICONS.play}<span>${state.output ? 'Process again' : 'Start processing'}</span><span class="button-arrow">→</span>`}</button>
                <p class="action-caption">${state.loading ? 'The engine is being prepared. First load may take a little longer.' : isEngineLoaded() ? 'Processing engine is ready on this device.' : 'The local engine downloads only when you start your first job.'}</p>
              </div>
            </section>
          </div>

          <section class="result-panel ${state.output ? 'has-output' : ''} ${state.busy || state.error || state.cancelled ? 'is-visible' : ''}" aria-live="polite">
            <div class="result-leading"><div class="result-icon ${state.error ? 'error' : ''}">${state.error ? '!' : state.busy ? '<span class="button-spinner dark"></span>' : state.cancelled ? ICONS.close : ICONS.download}</div><div class="result-copy"><strong>${state.error ? 'Something went wrong' : state.output ? 'Your file is ready' : state.busy ? 'Working on your video' : state.cancelled ? 'Job cancelled' : 'Your result will appear here'}</strong><span>${escapeHtml(state.error || state.status)}</span></div></div>
            ${state.busy ? `<div class="progress-wrap"><div class="progress-track"><div class="progress-fill" style="width:${state.progress == null ? 28 : Math.max(3, Math.round(state.progress * 100))}%"></div></div><div class="progress-meta"><span>${state.progress == null ? 'Processing…' : `${Math.round(state.progress * 100)}%`}</span><button id="cancel-button" class="text-button">Cancel job</button></div></div>` : ''}
            ${state.output && !state.busy ? `<div class="output-details"><div><span>Output file</span><strong title="${escapeHtml(state.output.name)}">${escapeHtml(state.output.name)}</strong></div><div><span>Output size</span><strong>${formatBytes(state.output.size)}</strong></div>${state.file ? `<div><span>Size change</span><strong class="${state.output.size < state.file.size ? 'positive' : ''}">${state.output.size < state.file.size ? `−${formatBytes(state.file.size - state.output.size)}` : state.output.size > state.file.size ? `+${formatBytes(state.output.size - state.file.size)}` : 'No change'}</strong></div>` : ''}</div><a class="download-button" id="download-button" href="${state.outputUrl}" download="${escapeHtml(state.output.name)}">${ICONS.download}<span>${state.tool === 'audio' ? 'Download audio' : 'Download file'}</span></a>` : ''}
          </section>

          <footer class="page-footer"><span>Built for your privacy <b>·</b> No accounts <b>·</b> No video uploads</span><span class="footer-note">Powered by FFmpeg WebAssembly</span></footer>
        </section>
      </main>
      <div class="toast" id="toast" role="status"></div>
    </div>
  `;
  bindEvents();
  if (state.file) attachVideoPreview(previousVideo);
}

function bindEvents() {
  document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => {
    if (state.busy || state.tool === button.dataset.tool) return;
    state.tool = button.dataset.tool;
    state.error = '';
    state.cancelled = false;
    state.status = 'Choose options, then start processing.';
    render();
  }));

  document.querySelectorAll('[data-option]').forEach((control) => {
    control.addEventListener('input', () => { state.options[control.dataset.option] = control.value; });
  });

  const input = document.querySelector('#file-input');
  const dropZone = document.querySelector('#drop-zone');
  if (input && dropZone) {
    dropZone.addEventListener('click', (event) => {
      // input.click() bubbles back up to this handler; ignore that echo.
      if (event.target === input || event.target.closest('button')) return;
      if (!state.busy) input.click();
    });
    dropZone.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !state.busy) {
        event.preventDefault(); input.click();
      }
    });
    input.addEventListener('change', () => { if (input.files?.[0]) selectFile(input.files[0]); });
    dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault(); dropZone.classList.remove('dragging');
      if (state.busy) { showToast('Wait for the current job to finish, or cancel it first.'); return; }
      const file = [...(event.dataTransfer?.files || [])].find(looksLikeVideo);
      if (file) selectFile(file);
      else showToast('Choose a supported video file.');
    });
  }

  document.querySelector('#remove-file')?.addEventListener('click', (event) => { event.stopPropagation(); clearSelectedFile(); });
  document.querySelector('#start-button')?.addEventListener('click', processVideo);
  document.querySelector('#cancel-button')?.addEventListener('click', cancelJob);
}

function looksLikeVideo(file) {
  return file.type.startsWith('video/') || VIDEO_NAME_PATTERN.test(file.name);
}

function attachVideoPreview(previousVideo) {
  const video = document.querySelector('#source-preview');
  if (!video || !state.inputUrl) return;
  // Re-use the existing <video> for the same file so a re-render does not reload it (and its
  // listeners, which are still attached, keep working).
  if (previousVideo && previousVideo.dataset.src === state.inputUrl) {
    video.replaceWith(previousVideo);
    return;
  }
  video.dataset.src = state.inputUrl;
  video.src = state.inputUrl;
  video.addEventListener('loadedmetadata', () => {
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const width = video.videoWidth || null;
    const height = video.videoHeight || null;
    const previewUnavailable = !width || !height;
    // The preview is recreated when the UI rerenders; only rerender if metadata changed.
    if (state.metadata.width === width && state.metadata.height === height && state.metadata.duration === duration && state.metadata.previewError === previewUnavailable) return;
    state.metadata.duration = duration;
    state.metadata.width = width;
    state.metadata.height = height;
    state.metadata.previewError = previewUnavailable;
    // Default the trim end point to the full length unless the person has already typed one.
    if (duration && !state.options.end) state.options.end = String(Math.floor(duration * 10) / 10);
    const focused = document.activeElement?.id;
    render();
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  }, { once: true });
  video.addEventListener('error', () => {
    if (state.metadata.previewError) return;
    state.metadata.previewError = true;
    state.metadata.duration = null;
    state.metadata.width = null;
    state.metadata.height = null;
    // Only rerender if the app hasn't already shown the fallback for this file.
    if (document.querySelector('#source-preview')) render();
  }, { once: true });
}

function selectFile(file) {
  if (state.busy) return;
  if (!looksLikeVideo(file)) { showToast('Choose a video file to continue.'); return; }
  if (file.size === 0) { showToast('This file is empty. Choose another video.'); return; }
  releaseInputUrl();
  releaseOutputUrl();
  state.file = file;
  state.inputUrl = URL.createObjectURL(file);
  state.output = null;
  state.error = '';
  state.cancelled = false;
  state.progress = null;
  // The warning stays visible in the source panel (a toast disappears before it can be read).
  state.warning = file.size > LARGE_FILE_BYTES
    ? `Large file (${formatBytes(file.size)}). Processing happens in your browser's memory, so it may be slow or fail on phones and low-memory devices. A shorter or smaller clip is safer.`
    : '';
  state.options.start = '0';
  state.options.end = '';
  state.status = 'Video selected. Choose options and start processing.';
  state.metadata = { duration: null, width: null, height: null, previewError: false };
  render();
}

function clearSelectedFile() {
  if (state.busy) return;
  releaseInputUrl();
  releaseOutputUrl();
  state.file = null;
  state.output = null;
  state.error = '';
  state.cancelled = false;
  state.warning = '';
  state.progress = null;
  state.options.start = '0';
  state.options.end = '';
  state.metadata = { duration: null, width: null, height: null };
  state.status = 'Choose a video to begin.';
  render();
}

function releaseInputUrl() {
  if (state.inputUrl) URL.revokeObjectURL(state.inputUrl);
  state.inputUrl = null;
}
function releaseOutputUrl() {
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  state.outputUrl = null;
}

async function processVideo() {
  if (!state.file || state.busy) return;
  const options = { ...state.options };
  if (state.tool === 'trim') {
    const start = Number(options.start);
    const end = Number(options.end);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) {
      state.error = 'Enter a valid start time and an end time greater than the start time.';
      state.status = 'Check the trim settings and try again.';
      render(); return;
    }
    if (state.metadata.duration && end > state.metadata.duration) {
      state.error = `The end time is beyond this video's duration (${formatDuration(state.metadata.duration)}).`;
      state.status = 'Check the trim settings and try again.';
      render(); return;
    }
  }
  if (state.tool === 'audio' && state.metadata.duration === 0) {
    state.error = 'Could not detect a valid video duration.';
    render(); return;
  }

  const token = ++jobToken;
  const tool = state.tool;
  state.busy = true;
  state.loading = !isEngineLoaded();
  state.cancelled = false;
  state.progress = null;
  state.error = '';
  state.output = null;
  releaseOutputUrl();
  state.status = state.loading ? 'Loading the local processing engine. The first load can be about 31 MB.' : 'Preparing job…';
  render();

  try {
    const details = outputDetails(tool, options, safeBaseName(state.file.name));
    const result = await runFFmpeg({
      tool,
      inputFile: state.file,
      inputExtension: extensionOf(state.file.name),
      outputName: details.name,
      inputArgs: buildInputArguments(tool, options),
      args: (outputPath) => buildArguments(tool, options, outputPath),
      onProgress: (progress) => {
        if (token !== jobToken) return;
        state.progress = progress;
        const bar = document.querySelector('.progress-fill');
        const percent = document.querySelector('.progress-meta > span');
        if (bar) bar.style.width = `${Math.max(3, Math.round(progress * 100))}%`;
        if (percent) percent.textContent = `${Math.round(progress * 100)}%`;
      },
      onStatus: (status) => {
        if (token !== jobToken) return;
        state.status = status;
        state.loading = status.includes('Downloading') || status.includes('Loading');
        const resultStatus = document.querySelector('.result-copy span');
        if (resultStatus) resultStatus.textContent = status;
        const caption = document.querySelector('.action-caption');
        if (caption) caption.textContent = status;
      },
      onLog: (message) => { state.log = message; },
    });
    if (token !== jobToken) return;
    state.output = { name: result.name, size: result.size, blob: result.blob };
    state.outputUrl = URL.createObjectURL(result.blob);
    state.status = 'Finished successfully. The file is ready to download.';
    state.progress = 1;
  } catch (error) {
    // A cancelled job: cancelJob() has already updated the screen.
    if (token !== jobToken || isCancelled(error)) return;
    state.error = errorText(error) || 'The video could not be processed. Try another file or setting.';
    state.status = 'The job did not finish.';
  } finally {
    if (token === jobToken) {
      state.busy = false;
      state.loading = false;
      render();
    }
  }
}

function cancelJob() {
  if (!state.busy) return;
  jobToken += 1; // anything the stopped job reports from now on is ignored
  cancelProcessing();
  state.busy = false;
  state.loading = false;
  state.cancelled = true;
  state.error = '';
  state.progress = null;
  state.status = 'Processing was cancelled. Start a new job when ready.';
  render();
}

let toastTimer;
function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3500);
}

window.addEventListener('beforeunload', (event) => {
  if (state.busy) {
    // Leaving mid-job throws the work away; let the browser ask first.
    event.preventDefault();
    event.returnValue = '';
    return;
  }
  releaseInputUrl();
  releaseOutputUrl();
});

render();
