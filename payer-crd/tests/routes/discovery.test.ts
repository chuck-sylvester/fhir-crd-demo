// ---------------------------------------------------------------------
// payer-crd/tests/routes/discovery.test.ts
// ---------------------------------------------------------------------
// Tests for GET /cds-services (src/routes/discovery.ts).
//
// Run: bun test tests/routes/discovery.test.ts
//
// A minimal Hono app is constructed here with only the discovery route
// registered. app.request() exercises the handler without binding a
// real TCP socket, so no port conflicts occur and no server cleanup
// is needed.
// ---------------------------------------------------------------------

import { describe, test, expect, beforeAll } from 'bun:test';
import { Hono } from 'hono';
import { discoveryHandler } from '../../src/routes/discovery.js';

// Local types for the discovery response shape.
// The discovery endpoint is not part of the CDS Hooks request/response
// contract in cdsHooks.ts, so these are declared here for test use only.
interface DiscoveryService {
  hook: string;
  id: string;
  title?: string;
  description?: string;
  prefetch?: Record<string, string>;
}

interface DiscoveryResponse {
  services: DiscoveryService[];
}

const app = new Hono();
app.get('/cds-services', discoveryHandler);

describe('GET /cds-services', () => {
  let response: Response;
  let body: DiscoveryResponse;

  beforeAll(async () => {
    response = await app.request('/cds-services');
    body = await response.json() as DiscoveryResponse;
  });

  test('returns HTTP 200', () => {
    expect(response.status).toBe(200);
  });

  test('Content-Type is application/json', () => {
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('response body contains services array', () => {
    expect(Array.isArray(body.services)).toBe(true);
  });

  test('services[0].hook is order-sign', () => {
    expect(body.services[0]?.hook).toBe('order-sign');
  });

  test('services[0].id is crd-order-sign', () => {
    expect(body.services[0]?.id).toBe('crd-order-sign');
  });

  test('services[0].prefetch contains all four required keys', () => {
    const prefetch = body.services[0]?.prefetch;
    expect(prefetch).toHaveProperty('patient');
    expect(prefetch).toHaveProperty('conditions');
    expect(prefetch).toHaveProperty('coverage');
    expect(prefetch).toHaveProperty('priorProcedures');
  });
});
