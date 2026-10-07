import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5181 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
