import test from 'node:test';
import assert from 'node:assert/strict';
import { JobCancelledError, JobError, classifyFailure, errorText, isCancelled } from '../src/lib/errors.js';

test('errorText copes with the plain strings FFmpeg.wasm rejects with', () => {
  assert.equal(errorText('boom'), 'boom');
  assert.equal(errorText(new Error('bang')), 'bang');
  assert.equal(errorText(undefined), '');
  assert.equal(errorText({}), '');
});

test('cancellation is recognisable and distinct from a failure', () => {
  assert.ok(isCancelled(new JobCancelledError()));
  assert.ok(!isCancelled(new JobError('x')));
  assert.ok(!isCancelled('called FFmpeg.terminate()'));
});

test('a silent video gives a clear message for audio extraction only', () => {
  const log = ['Output #0, mp3, to \'result.mp3\':', 'Output file #0 does not contain any stream'];
  assert.equal(classifyFailure({ tool: 'audio', logLines: log }).code, 'NO_AUDIO');
  assert.match(classifyFailure({ tool: 'audio', logLines: log }).message, /no audio track/i);
  assert.equal(classifyFailure({ tool: 'compress', logLines: log }).code, 'NO_STREAMS');
});

test('engine crashes are reported as memory problems', () => {
  for (const thrown of ['RuntimeError: memory access out of bounds', 'RangeError: Array buffer allocation failed', 'Cannot enlarge memory arrays']) {
    assert.equal(classifyFailure({ tool: 'compress', thrown }).code, 'MEMORY', thrown);
  }
});

test('damaged and unsupported inputs are recognised from the FFmpeg log', () => {
  assert.equal(classifyFailure({ tool: 'compress', logLines: ['source.mp4: Invalid data found when processing input'] }).code, 'INVALID_INPUT');
  assert.equal(classifyFailure({ tool: 'compress', logLines: ['moov atom not found'] }).code, 'INVALID_INPUT');
  assert.equal(classifyFailure({ tool: 'compress', logLines: ['Unknown encoder \'libvpx-vp9\''] }).code, 'ENCODER_MISSING');
  assert.equal(classifyFailure({ tool: 'compress', logLines: ['[libx264 @ 0x1] width not divisible by 2 (641x361)'] }).code, 'ODD_DIMENSIONS');
});

test('unknown failures keep a generic message and include the thrown detail', () => {
  const generic = classifyFailure({ tool: 'compress', logLines: ['something odd'] });
  assert.equal(generic.code, 'FFMPEG_FAILED');
  assert.ok(!generic.message.includes('('));
  assert.match(classifyFailure({ tool: 'compress', thrown: 'weird failure' }).message, /\(weird failure\)/);
});
