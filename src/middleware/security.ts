import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import type { Express } from 'express'

export function setupSecurity (app: Express): void {
  app.use(helmet({
    // Content Security Policy - restrict resource loading
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: []
      }
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    },
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' }
  }))

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')

  app.use(cors({
    origin: (origin, callback) => {
    if (!origin) {
            // In production reject requests without origin
            if (process.env.NODE_ENV === 'production') {
              callback(new Error('Origin required'))
              return
            }
            callback(null, true)
            return
          }

      if (allowedOrigins?.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }))

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
  })
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // Only 10 auth attempts per 15 min
    message: { error: 'Too many authentication attempts' },
    standardHeaders: true,
    legacyHeaders: false
  })

  app.use(limiter)
  app.use('/api/auth', authLimiter)

}

