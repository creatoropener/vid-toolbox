import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { JobCancelledError, JobError, classifyFailure, errorText, isCancelled } from './errors.js';

// Pin the core version to avoid a silent runtime change when this app is deployed.
const CORE_BASE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

// If the worker or WebAssembly module never starts, fail instead of showing a spinner forever.
const ENGINE_START_TIMEOUT_MS = 60_000;
// WebAssembly memory never shrinks. After a large job the engine is thrown away so the browser can
// reclaim that memory; the downloaded core is cached, so the next job only pays a short restart.
const RECYCLE_ENGINE_ABOVE_BYTES = 64 * 1000 * 1000;
const LOG_TAIL_LINES = 40;

const MIME_TYPES = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

let assetsPromise = null; // blob: URLs for the core, kept for the whole page session
let engine = null;
let enginePromise = null;
let generation = 0; // bumped every time the engine is discarded; lets stale async work notice
let activeJob = null;

export function isEngineLoaded() {
  return Boolean(engine?.loaded);
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function loadAssets(onStatus) {
  if (!assetsPromise) {
    onStatus('Downloading the local processing engine…');
    assetsPromise = Promise.all([
      toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    ])
      .then(([coreURL, wasmURL]) => ({ coreURL, wasmURL }))
      .catch((error) => {
        assetsPromise = null; // allow a retry
        throw error;
      });
  }
  return assetsPromise;
}

function discardEngine() {
  generation += 1;
  const old = engine;
  engine = null;
  enginePromise = null;
  if (old) {
    try { old.terminate(); } catch { /* The worker may already be gone. */ }
  }
}

export function loadEngine({ onStatus = () => {} } = {}) {
  if (engine?.loaded) return Promise.resolve(engine);
  if (enginePromise) return enginePromise;

  const gen = generation;
  const promise = (async () => {
    let instance = null;
    let stage = 'download';
    try {
      const assets = await loadAssets(onStatus);
      if (gen !== generation) throw new JobCancelledError();

      stage = 'start';
      onStatus('Starting the processing engine…');
      instance = new FFmpeg();
      instance.on('progress', ({ progress }) => {
        if (activeJob && Number.isFinite(progress)) activeJob.onProgress(Math.max(0, Math.min(1, progress)));
      });
      instance.on('log', ({ message }) => {
        if (!activeJob || !message) return;
        activeJob.logTail.push(message);
        if (activeJob.logTail.length > LOG_TAIL_LINES) activeJob.logTail.shift();
        activeJob.onLog(message);
      });
      engine = instance; // visible to discardEngine() while it is still starting
      await withTimeout(instance.load(assets), ENGINE_START_TIMEOUT_MS, 'The engine did not start in time.');
      if (gen !== generation) throw new JobCancelledError();

      onStatus('Processing engine ready');
      return instance;
    } catch (error) {
      if (instance) {
        try { instance.terminate(); } catch { /* ignore */ }
        if (engine === instance) engine = null;
      }
      if (isCancelled(error) || gen !== generation) throw new JobCancelledError();
      const detail = errorText(error);
      throw new JobError(
        stage === 'download'
          ? `Could not download the video engine. Check your internet connection and try again. ${detail}`.trim()
          : `The video engine could not start in this browser. Reload the page and try again. ${detail}`.trim(),
        'ENGINE_LOAD_FAILED',
      );
    }
  })();

  enginePromise = promise;
  const clear = () => { if (enginePromise === promise) enginePromise = null; };
  promise.then(clear, clear);
  return promise;
}

export async function runFFmpeg({
  tool,
  inputFile,
  inputExtension,
  outputName,
  inputArgs = [],
  args,
  onProgress = () => {},
  onStatus = () => {},
  onLog = () => {},
}) {
  if (activeJob) throw new JobError('A video job is already running. Finish or cancel it before starting another.', 'BUSY');

  const job = { cancelled: false, onProgress, onLog, logTail: [] };
  activeJob = job;

  const safeInputExtension = /^[a-z0-9]{1,8}$/.test(inputExtension) ? inputExtension : 'bin';
  const inputName = `source.${safeInputExtension}`;
  const outputExtension = outputName.split('.').pop().toLowerCase();
  const outputPath = `result.${outputExtension}`;
  const stillActive = () => {
    if (job.cancelled) throw new JobCancelledError();
  };

  let instance = null;
  let failed = false;

  try {
    instance = await loadEngine({ onStatus });
    stillActive();

    onStatus('Preparing your video…');
    await instance.writeFile(inputName, await fetchFile(inputFile));
    stillActive();

    onStatus('Processing on your device…');
    const exitCode = await instance.exec(['-hide_banner', '-y', ...inputArgs, '-i', inputName, ...args(outputPath)]);
    stillActive();
    if (exitCode !== 0) {
      const { code, message } = classifyFailure({ tool, logLines: job.logTail });
      throw new JobError(message, code);
    }

    onStatus('Preparing download…');
    const fileData = await instance.readFile(outputPath);
    stillActive();
    const bytes = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
    const blob = new Blob([bytes], { type: MIME_TYPES[outputExtension] || 'application/octet-stream' });
    return { blob, size: blob.size, name: outputName };
  } catch (error) {
    if (job.cancelled || isCancelled(error)) throw new JobCancelledError();
    failed = true;
    if (error instanceof JobError) throw error;
    // FFmpeg.wasm rejects with plain strings, and a crash inside the engine leaves it unusable.
    const { code, message } = classifyFailure({ tool, logLines: job.logTail, thrown: errorText(error) });
    throw new JobError(message, code);
  } finally {
    if (activeJob === job) activeJob = null;
    // A cancelled job has already had its engine discarded (and a new job may own the new one).
    if (!job.cancelled) {
      if (failed || inputFile.size > RECYCLE_ENGINE_ABOVE_BYTES) {
        discardEngine();
      } else if (instance?.loaded) {
        for (const file of [inputName, outputPath]) {
          try { await instance.deleteFile(file); } catch { /* The file may not exist after a failed run. */ }
        }
      }
    }
  }
}

export function cancelProcessing() {
  if (activeJob) {
    activeJob.cancelled = true;
    activeJob = null;
  }
  discardEngine();
}
