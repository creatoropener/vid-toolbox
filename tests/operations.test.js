import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArguments, buildInputArguments, outputDetails } from '../src/tools/operations.js';

const filterOf = (args) => args[args.indexOf('-vf') + 1];

test('resolution presets add aspect-ratio-preserving scale filters', () => {
  for (const [preset, height] of [['480p', 480], ['720p', 720], ['1080p', 1080]]) {
    const args = buildArguments('resize', { resolution: preset, quality: 'balanced' }, 'result.mp4');
    assert.equal(filterOf(args), `scale=-2:${height}:flags=lanczos`);
  }
});

test('keeping the original size still rounds odd dimensions down to even ones', () => {
  // libx264 rejects odd sizes such as 641x361 for yuv420p, so the filter must always be present.
  for (const tool of ['compress', 'resize', 'mute']) {
    const args = buildArguments(tool, { resolution: 'original', quality: 'balanced' }, 'result.mp4');
    assert.equal(filterOf(args), 'scale=trunc(iw/2)*2:trunc(ih/2)*2', tool);
  }
  const webm = buildArguments('convert', { format: 'webm', resolution: 'original', quality: 'balanced' }, 'result.webm');
  assert.equal(filterOf(webm), 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
});

test('compressor emits MP4 H.264 output with chosen quality and a size-efficient preset', () => {
  const args = buildArguments('compress', { resolution: '720p', quality: 'smaller' }, 'result.mp4');
  assert.ok(args.includes('libx264'));
  assert.equal(args[args.indexOf('-crf') + 1], '29');
  assert.equal(args[args.indexOf('-preset') + 1], 'veryfast');
  assert.ok(args.includes('scale=-2:720:flags=lanczos'));
  assert.equal(args.at(-1), 'result.mp4');
});

test('quality presets map to distinct CRF values and unknown quality falls back to balanced', () => {
  const crf = (quality) => {
    const args = buildArguments('compress', { resolution: 'original', quality }, 'result.mp4');
    return args[args.indexOf('-crf') + 1];
  };
  assert.deepEqual([crf('smaller'), crf('balanced'), crf('quality'), crf('nonsense')], ['29', '23', '19', '23']);
});

test('WebM uses VP8 + Opus (libvpx-vp9 crashes the single-threaded core)', () => {
  const args = buildArguments('convert', { format: 'webm', resolution: 'original', quality: 'balanced' }, 'result.webm');
  assert.ok(args.includes('libvpx'));
  assert.ok(!args.includes('libvpx-vp9'));
  assert.ok(args.includes('libopus'));
  assert.ok(args.includes('yuv420p'));
  assert.equal(args.at(-1), 'result.webm');
});

test('MOV output uses the mov muxer and unknown formats fall back to MP4', () => {
  const mov = buildArguments('convert', { format: 'mov', resolution: 'original', quality: 'balanced' }, 'result.mov');
  assert.equal(mov[mov.indexOf('-f') + 1], 'mov');
  assert.deepEqual(outputDetails('convert', { format: 'mkv' }, 'clip'), { extension: 'mp4', name: 'clip-converted.mp4' });
  assert.deepEqual(outputDetails('convert', { format: 'webm' }, 'clip'), { extension: 'webm', name: 'clip-converted.webm' });
});

test('trim seeks on the input side and requests a rounded duration', () => {
  assert.deepEqual(buildInputArguments('trim', { start: '5', end: '12' }), ['-ss', '5', '-t', '7']);
  // 12.3 - 5.1 is 7.199999999999999 in floating point
  assert.deepEqual(buildInputArguments('trim', { start: '5.1', end: '12.3' }), ['-ss', '5.1', '-t', '7.2']);
  const args = buildArguments('trim', { start: '5', end: '12', quality: 'balanced' }, 'result.mp4');
  assert.ok(!args.includes('-ss') && !args.includes('-t'), 'seek options must not be output options');
  assert.equal(args.at(-1), 'result.mp4');
});

test('trim rejects an end time that is not after the start time', () => {
  assert.throws(() => buildArguments('trim', { start: 10, end: 4, quality: 'balanced' }, 'result.mp4'), /End time/);
  assert.throws(() => buildInputArguments('trim', { start: 10, end: 10 }), /End time/);
  assert.throws(() => buildInputArguments('trim', { start: 0, end: '' }), /End time/);
});

test('only trim has input arguments', () => {
  for (const tool of ['compress', 'convert', 'resize', 'audio', 'mute']) {
    assert.deepEqual(buildInputArguments(tool, {}), []);
  }
});

test('audio extraction drops video and writes MP3; mute drops audio', () => {
  const audio = buildArguments('audio', {}, 'result.mp3');
  assert.ok(audio.includes('-vn') && audio.includes('libmp3lame'));
  const mute = buildArguments('mute', { resolution: 'original', quality: 'balanced' }, 'result.mp4');
  assert.ok(mute.includes('-an') && !mute.includes('aac'));
});

test('unknown tools are rejected', () => {
  assert.throws(() => buildArguments('sepia', {}, 'result.mp4'), /Unknown tool/);
});

test('output names are generated for every tool', () => {
  assert.deepEqual(outputDetails('audio', {}, 'family-video'), { extension: 'mp3', name: 'family-video-audio.mp3' });
  assert.deepEqual(outputDetails('resize', { resolution: '1080p' }, 'family-video'), { extension: 'mp4', name: 'family-video-1080p.mp4' });
  assert.deepEqual(outputDetails('trim', {}, 'a'), { extension: 'mp4', name: 'a-trimmed.mp4' });
  assert.deepEqual(outputDetails('mute', {}, 'a'), { extension: 'mp4', name: 'a-muted.mp4' });
  assert.deepEqual(outputDetails('compress', {}, 'a'), { extension: 'mp4', name: 'a-compressed.mp4' });
});
