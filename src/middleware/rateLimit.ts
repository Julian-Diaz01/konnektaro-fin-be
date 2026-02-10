import rateLimit from 'express-rate-limit'
import type { Request, Response } from 'express'
import type { AuthenticatedRequest } from './auth.js'

/**
 * Per-user rate limiter for API endpoints
 * Limits each authenticated user to 20 requests per minute
 */
export const userRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per user
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  // Use user UID as the key for per-user limiting
  keyGenerator: (req: Request): string => {
    const authReq = req as AuthenticatedRequest
    if (authReq.user?.uid) {
      return `rate_limit:user:${authReq.user.uid}`
    }
    // Fallback to IP if no user (shouldn't happen for authenticated routes)
    return req.ip || 'unknown'
  },
  handler: (req: Request, res: Response) => {
    // req.rateLimit is not in the standard Request type; use (req as any).rateLimit to avoid TypeScript error
    const retryAfterSeconds = Math.ceil(
      ((req as any).rateLimit?.resetTime
        ? (req as any).rateLimit.resetTime - Date.now()
        : 60000) / 1000
    );
    res.status(429).json({
      error: 'Too many requests. Please limit to 20 requests per minute.',
      retryAfter: retryAfterSeconds,
    });
  }
})
