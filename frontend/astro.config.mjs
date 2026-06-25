// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
    // Dev only: forward API calls to the FastAPI backend. In production the built
    // site is served by FastAPI, so /api is already same-origin.
    server: { proxy: { "/api": "http://127.0.0.1:8080" } },
  },
});