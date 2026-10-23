import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs make the build easier to host on static platforms.
  base: './',
  // @ffmpeg/ffmpeg starts its worker with `new Worker(new URL('./worker.js', import.meta.url))`.
  // Vite's dev-time dependency pre-bundling moves the package and breaks that URL, which made
  // `npm run dev` hang forever on "Downloading the local processing engine…".
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
