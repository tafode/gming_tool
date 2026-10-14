import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { createPdfMiddleware, resolvePdfFolder } from './tools/pdf-server.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

// The reference shelf: a folder of PDFs on disk, served alongside the app.
const pdfFolder = resolvePdfFolder(root, process.env.PDF_DIR);

function referencePdfs() {
  return {
    name: 'gming-reference-pdfs',
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(createPdfMiddleware(pdfFolder));
      server.config.logger.info(`  ➜  Reference PDFs: ${pdfFolder}`);
    },
    configurePreviewServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(createPdfMiddleware(pdfFolder));
      server.config.logger.info(`  ➜  Reference PDFs: ${pdfFolder}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), referencePdfs()],
  // The app fetches nothing from this server except its own assets and the
  // reference PDFs, so it only ever listens on the loopback interface.
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
