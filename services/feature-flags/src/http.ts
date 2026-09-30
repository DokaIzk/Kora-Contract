/**
 * Feature Flag Service — HTTP + SSE Interface
 *
 * Exposes:
 *   GET  /flags                → session-start snapshot for authenticated user
 *   GET  /flags/stream         → SSE stream for kill-switch propagation
 *   GET  /flags/:name          → single flag resolution for a user
 *   POST /admin/flags          → upsert a flag (admin only)
 *   PUT  /admin/flags/:name/enable    → re-enable a flag
 *   PUT  /admin/flags/:name/disable   → instant kill-switch
 *
 * All evaluation endpoints require a resolved userId in the request context
 * (set by upstream auth middleware — not included here).
 *
 * The SSE stream (/flags/stream) sends FlagChangeEvent objects whenever a flag
 * is toggled, allowing clients to react without polling. Clients in a disabled
 * feature flow receive a graceful-disable message.
 */

import { IncomingMessage, ServerResponse } from "http";
import pino from "pino";
import { FeatureFlagService } from "./service";
import { FeatureName } from "./types";

const logger = pino({ name: "feature-flags:http" });

/** Minimal request shape — real implementation comes from the API gateway framework. */
export interface FlagRequest extends IncomingMessage {
  userId?: string;        // set by auth middleware
  adminActor?: string;    // set by admin-auth middleware
  body?: unknown;
}

/**
 * Session-start: resolve all flags for the authenticated user.
 * Called once per session; result is cached by the client until a kill-switch event.
 */
export function handleFlagsSnapshot(
  svc: FeatureFlagService,
  req: FlagRequest,
  res: ServerResponse
): void {
  const userId = req.userId;
  if (!userId) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthenticated" }));
    return;
  }

  const snapshot = svc.resolveForUser(userId);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ flags: snapshot }));
}

/**
 * SSE kill-switch stream.
 * Clients connect once and hold the connection; pushed events tell them when
 * a flag they are using has been disabled so the UI can show a graceful message.
 *
 * Event format:
 *   data: {"type":"flag-changed","name":"secondary-market","value":false,"changedAt":"..."}
 */
export function handleFlagsStream(
  svc: FeatureFlagService,
  req: FlagRequest,
  res: ServerResponse
): void {
  if (!req.userId) {
    res.writeHead(401);
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // nginx: disable buffering for SSE
  });

  // Send a heartbeat immediately to confirm the connection
  res.write("event: connected\ndata: {}\n\n");

  // Register for kill-switch events
  const cleanup = svc.onKillSwitch((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected
    }
  });

  // Heartbeat every 30s to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
      cleanup();
    }
  }, 30_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    cleanup();
    logger.debug({ userId: req.userId }, "SSE client disconnected");
  });
}

/**
 * Admin: disable a flag (kill-switch).
 */
export async function handleDisableFlag(
  svc: FeatureFlagService,
  req: FlagRequest,
  res: ServerResponse,
  name: string
): Promise<void> {
  if (!req.adminActor) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required" }));
    return;
  }

  try {
    await svc.disable(name as FeatureName, req.adminActor);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, flag: name, enabled: false }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, flag: name }, "Failed to disable flag");
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

/**
 * Admin: enable a flag.
 */
export async function handleEnableFlag(
  svc: FeatureFlagService,
  req: FlagRequest,
  res: ServerResponse,
  name: string
): Promise<void> {
  if (!req.adminActor) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Admin access required" }));
    return;
  }

  try {
    await svc.enable(name as FeatureName, req.adminActor);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, flag: name, enabled: true }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, flag: name }, "Failed to enable flag");
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}
