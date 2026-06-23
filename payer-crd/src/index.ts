// ---------------------------------------------------------------------
// payer-crd/src/index.ts
// ---------------------------------------------------------------------
// Application entrypoint: creates the Hono app, registers routes,
// and starts the server with Bun.serve().
//
// Run from payer-crd root folder:
//       Command: bun run dev
//    Access via: http://localhost:8080
//   Stop server: Ctrl + C
//
// Routes:
//   GET  /cds-services                 —> src/routes/discovery.ts
//   POST /cds-services/crd-order-sign  —> src/routes/crd.ts
//
// Hono returns HTTP 404 for any path not listed above — no manual
// 404 handler is needed.
// ---------------------------------------------------------------------

import { Hono } from 'hono';
import { discoveryHandler } from './routes/discovery.js';

const app = new Hono();

app.get('/cds-services', discoveryHandler);

const port = Number(Bun.env.PORT) || 8080;

// app.fetch is a standard Web Fetch API handler (Request → Response).
// Bun.serve's fetch option accepts this interface directly.
Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Payer CRD listening on port ${port}`);
