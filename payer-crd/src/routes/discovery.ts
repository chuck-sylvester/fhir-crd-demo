// ---------------------------------------------------------------------
// payer-crd/src/routes/discovery.ts
// ---------------------------------------------------------------------
// Handler for GET /cds-services — the CDS Hooks discovery endpoint.
// Returns the fixture file verbatim; no request body is read.
//
// Registered in: src/index.ts
// Fixture:       fixtures/cds-discovery.json
// ---------------------------------------------------------------------

import type { Context } from 'hono';

export async function discoveryHandler(c: Context): Promise<Response> {
  // Path is relative to the process working directory (payer-crd/),
  // not to this source file's location.
  const data = await Bun.file('fixtures/cds-discovery.json').json();
  return c.json(data, 200);
}
  