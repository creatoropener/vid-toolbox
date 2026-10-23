export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const digitsFor = (value) => (value >= 100 ? 0 : value >= 10 ? 1 : 2);
  let value = bytes / 1000;
  let index = 0;
  // Compare the *rounded* number so 999.6 KB becomes "1.00 MB" rather than "1000 KB".
  while (index < units.length - 1 && Number(value.toFixed(digitsFor(value))) >= 1000) {
    value /= 1000;
    index += 1;
  }
  return `${value.toFixed(digitsFor(value))} ${units[index]}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function safeBaseName(filename) {
  const withoutExtension = filename.replace(/\.[^.]+$/, '');
  const cleaned = withoutExtension
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || 'video';
}

export function extensionOf(filename) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match?.[1] || 'bin';
}
