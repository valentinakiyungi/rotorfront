import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages /rotorfront/).
  base: './',
  server: { host: true }, // reachable from your phone on the same Wi-Fi
  build: { target: 'es2022' },
});
