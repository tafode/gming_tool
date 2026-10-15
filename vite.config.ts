import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { createPdfMiddleware, resolvePdfFolder } from './tools/pdf-server.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

// The reference shelf: a folder of documents on disk, served alongside the app.
// `DOC_DIR` is the newer name; `PDF_DIR` is kept working for existing setups.
const documentFolder = resolvePdfFolder(root, process.env.DOC_DIR ?? process.env.PDF_DIR);

function referenceDocuments() {
  return {
    name: 'gming-reference-documents',
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(createPdfMiddleware(documentFolder));
      server.config.logger.info(`  ➜  Reference documents: ${documentFolder}`);
    },
    configurePreviewServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(createPdfMiddleware(documentFolder));
      server.config.logger.info(`  ➜  Reference documents: ${documentFolder}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), referenceDocuments()],
  // The app fetches nothing from this server except its own assets and the
  // reference documents, so it only ever listens on the loopback interface.
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
