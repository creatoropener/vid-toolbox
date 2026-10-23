const RESOLUTION_HEIGHTS = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
};

function scaleArgs(resolution) {
  const height = RESOLUTION_HEIGHTS[resolution];
  // -2 keeps the aspect ratio and makes the calculated width divisible by 2, which yuv420p H.264
  // and VP8 require. When keeping the original size, still round odd dimensions down to even ones;
  // otherwise libx264 refuses sources such as 641x361 ("width not divisible by 2").
  return ['-vf', height ? `scale=-2:${height}:flags=lanczos` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
}

function qualityCrf(quality) {
  return ({ smaller: '29', balanced: '23', quality: '19' })[quality] || '23';
}

// Encoder speed matters a lot in single-threaded WebAssembly, but so does file size: on a 720p test
// clip `ultrafast` produced a file ~2.7x larger than `veryfast` at the same CRF (and larger than the
// source). Compress therefore uses `veryfast`; tools where size is secondary use `superfast`.
const COMPRESS_PRESET = 'veryfast';
const DEFAULT_PRESET = 'superfast';

function h264Args({ resolution, quality = 'balanced', audio = true, preset = DEFAULT_PRESET } = {}) {
  return [
    ...scaleArgs(resolution),
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', qualityCrf(quality),
    '-pix_fmt', 'yuv420p',
    ...(audio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
    '-movflags', '+faststart',
  ];
}

// WebM uses VP8 + Opus: libvpx-vp9 in the single-threaded @ffmpeg/core 0.12.10 build crashes the
// engine ("memory access out of bounds") with every option set that was tried, while libvpx (VP8) works.
function webmArgs({ resolution, quality = 'balanced' }) {
  const [crf, maxBitrate] = ({ smaller: ['16', '2M'], balanced: ['10', '4M'], quality: ['6', '8M'] })[quality] || ['10', '4M'];
  return [
    ...scaleArgs(resolution),
    '-c:v', 'libvpx',
    '-deadline', 'realtime',
    '-cpu-used', '5',
    '-crf', crf,
    '-b:v', maxBitrate,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'libopus',
    '-b:a', '96k',
  ];
}

const roundSeconds = (value) => String(Math.round(value * 1000) / 1000);

export function trimWindow(options) {
  const start = Math.max(0, Number(options.start) || 0);
  const end = Number(options.end);
  if (!Number.isFinite(end) || end <= start) throw new Error('End time must be greater than start time.');
  return { start, end, duration: end - start };
}

// Options that must appear before `-i`. Seeking on the input side lets FFmpeg jump straight to the
// start point instead of decoding everything before it (very slow in WebAssembly), and because the
// clip is re-encoded the cut is still frame-accurate.
export function buildInputArguments(tool, options = {}) {
  if (tool === 'trim') {
    const { start, duration } = trimWindow(options);
    return ['-ss', roundSeconds(start), '-t', roundSeconds(duration)];
  }
  return [];
}

export function buildArguments(tool, options, outputPath) {
  if (tool === 'compress') {
    return [...h264Args({ resolution: options.resolution, quality: options.quality, preset: COMPRESS_PRESET }), outputPath];
  }

  if (tool === 'resize') {
    return [...h264Args({ resolution: options.resolution, quality: options.quality }), outputPath];
  }

  if (tool === 'convert') {
    if (options.format === 'webm') {
      return [...webmArgs({ resolution: options.resolution, quality: options.quality }), outputPath];
    }
    const muxer = options.format === 'mov' ? 'mov' : 'mp4';
    return [...h264Args({ resolution: options.resolution, quality: options.quality }), '-f', muxer, outputPath];
  }

  if (tool === 'trim') {
    trimWindow(options); // validates the times; the cut itself is applied by buildInputArguments()
    return [...h264Args({ resolution: 'original', quality: options.quality }), outputPath];
  }

  if (tool === 'audio') {
    return ['-vn', '-c:a', 'libmp3lame', '-q:a', '2', outputPath];
  }

  if (tool === 'mute') {
    return [...h264Args({ resolution: options.resolution, quality: options.quality, audio: false }), outputPath];
  }

  throw new Error('Unknown tool selected.');
}

export function outputDetails(tool, options, baseName) {
  if (tool === 'audio') return { extension: 'mp3', name: `${baseName}-audio.mp3` };
  if (tool === 'convert') {
    const format = ['mp4', 'webm', 'mov'].includes(options.format) ? options.format : 'mp4';
    return { extension: format, name: `${baseName}-converted.${format}` };
  }
  if (tool === 'trim') return { extension: 'mp4', name: `${baseName}-trimmed.mp4` };
  if (tool === 'mute') return { extension: 'mp4', name: `${baseName}-muted.mp4` };
  if (tool === 'resize') return { extension: 'mp4', name: `${baseName}-${options.resolution || 'original'}.mp4` };
  return { extension: 'mp4', name: `${baseName}-compressed.mp4` };
}
