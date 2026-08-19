/**
 * Compile-only consumer contract. `tsconfig.test.json` includes this file, so
 * the ordinary project typecheck proves the exact-optional-false surface
 * without starting a nested TypeScript process inside a timed unit test.
 */
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createCailLogger,
  defineEventCatalog,
} from "../src/index.js";

const platform = createCailLogger({
  service: "gateway",
  release: "local",
  env: "test",
  sourceClass: "platform",
  subjectVersion: "v1",
  catalog: CAIL_EVENT_CATALOG,
  sink: () => {},
});

platform.emit(CAIL_EVENTS.ACTION_ADMITTED, {
  action_id: "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7",
  product_id: "kale-workbench",
  principal: { type: "anonymous", subject: undefined },
  request_id: undefined,
});

platform.emit(CAIL_EVENTS.ACTION_TERMINAL, {
  action_id: "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7",
  product_id: "kale-workbench",
  principal: { type: "anonymous" },
  terminal: { outcome: "ok", reason: "completed" },
  duration_ms: 1,
  error_type: undefined,
});

const tenantCatalog = defineEventCatalog({
  "tenant.ready": {
    source: "tenant",
    severity: "info",
    required: [],
    optional: [],
  },
});

createCailLogger({
  service: "tenant-service",
  release: "local",
  env: "test",
  sourceClass: "tenant",
  subjectVersion: undefined,
  catalog: tenantCatalog,
  sink: () => {},
});
