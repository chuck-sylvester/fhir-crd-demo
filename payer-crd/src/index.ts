// ---------------------------------------------------------------------
// payer-crd/src/index.ts
// ---------------------------------------------------------------------
// Run from payer-crd root folder:
//       Command: bun run dev
//    Access via: localhost:8080
//   Stop server: CTRL + C
// ---------------------------------------------------------------------

import { Hono } from "hono";

const app = new Hono();

app.get('/', (c) => c.text('payer-crd starting up'));

const port = Number(Bun.env.PORT) || 8080

Bun.serve({
    port,
    fetch: app.fetch,
});

console.log(`Payer CRD listening on port ${port}`);
