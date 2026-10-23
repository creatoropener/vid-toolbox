// FFmpeg.wasm rejects with plain strings as well as Error objects, so never rely on `error.message`.
export function errorText(error) {
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return '';
}

// An error whose message is already written for the person using the app.
export class JobError extends Error {
  constructor(message, code = 'FFMPEG_FAILED') {
    super(message);
    this.name = 'JobError';
    this.code = code;
  }
}

export class JobCancelledError extends Error {
  constructor() {
    super('Processing was cancelled.');
    this.name = 'JobCancelledError';
  }
}

export function isCancelled(error) {
  return error?.name === 'JobCancelledError';
}

// Turn a failed FFmpeg run into something a person can act on.
// `logLines` are the last lines FFmpeg printed; `thrown` is the exception text, if any.
export function classifyFailure({ tool, logLines = [], thrown = '' }) {
  const text = `${logLines.join('\n')}\n${thrown}`;

  if (/does not contain any stream|matches no streams/i.test(text)) {
    return tool === 'audio'
      ? { code: 'NO_AUDIO', message: 'This video has no audio track, so there is nothing to extract.' }
      : { code: 'NO_STREAMS', message: 'No usable audio or video was found in this file.' };
  }
  if (/memory access out of bounds|out of memory|could not allocate|cannot enlarge memory|array buffer allocation failed|invalid array length/i.test(text)) {
    return { code: 'MEMORY', message: 'The processing engine ran out of memory or crashed. Try a shorter or smaller video, or close other tabs and retry.' };
  }
  if (/Invalid data found when processing input|moov atom not found|Error opening input|could not find codec parameters|Invalid argument.*source\./i.test(text)) {
    return { code: 'INVALID_INPUT', message: 'This file could not be read. It may be damaged, incomplete, or in a format this engine does not support.' };
  }
  if (/Decoder .* not found|Unknown decoder|Unsupported codec/i.test(text)) {
    return { code: 'UNSUPPORTED_CODEC', message: 'This video uses a codec the processing engine cannot decode.' };
  }
  if (/Unknown encoder|Encoder .* not found/i.test(text)) {
    return { code: 'ENCODER_MISSING', message: 'The processing engine does not include the encoder needed for this output.' };
  }
  if (/not divisible by 2/i.test(text)) {
    return { code: 'ODD_DIMENSIONS', message: 'This video has odd dimensions that the encoder cannot use.' };
  }
  const detail = String(thrown || '').trim() ? ` (${String(thrown).trim().slice(0, 160)})` : '';
  return { code: 'FFMPEG_FAILED', message: `FFmpeg could not complete this job. The input may use an unsupported codec or be damaged.${detail}` };
}
