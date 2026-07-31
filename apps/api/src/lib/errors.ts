import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger';

// ============================================================
// Centralized error handling. Every API response — success or
// failure — follows the same shape:
//   { success: boolean, message: string, data: T | null, error: string | null }
//
// Route handlers should either:
//   - respond directly with `ok(res, data, message)` on success, or
//   - `throw new AppError(message, statusCode)` on a known failure
//     (e.g. bad input, not found, unauthorized) — the error
//     middleware below catches it and formats the response.
// Anything else that throws (a bug, a DB hiccup) is logged with
// full detail server-side but the client only ever sees a generic
// "Something went wrong" message — never a raw stack trace.
// ============================================================

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function ok<T>(res: Response, data: T, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data, error: null });
}

export function fail(res: Response, message: string, statusCode = 400, error: string | null = null) {
  return res.status(statusCode).json({ success: false, message, data: null, error: error ?? message });
}

/** Wrap an async route handler so thrown errors reach the error middleware instead of crashing the process. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// Must be registered LAST, after all routes, per Express convention.
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    logger.warn('request.handled_error', { path: req.path, message: err.message, statusCode: err.statusCode });
    return fail(res, err.message, err.statusCode);
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error('request.unhandled_error', { path: req.path, message, stack: err instanceof Error ? err.stack : undefined });
  return fail(res, 'Something went wrong. Please try again.', 500, 'internal_server_error');
}
