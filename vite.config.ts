/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `--mode lan` (npm run dev:phone) serves over HTTPS with a self-signed cert.
// Phones only allow camera access on secure origins, and a LAN IP over plain
// http is not one. On the desktop, http://localhost is already secure.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'lan' ? [basicSsl()] : [])],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
