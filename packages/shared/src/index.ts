// @fx/shared — single source of cross-service contracts (SPEC §6).
// All cross-service payloads validate at boundaries; invalid = rejected, never coerced.
export * from "./intent.js";
export * from "./services.js";
export * from "./gate.js";
export * from "./queue.js";
export * from "./bridge.js";
export * from "./audit.js";
