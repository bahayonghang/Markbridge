import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { chooseDevPort } from '../../scripts/dev-port.mjs';

export default defineConfig(async () => {
  const port = await chooseDevPort();
  return {
    plugins: [react()],
    clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: true },
    build: { sourcemap: false },
  };
});
