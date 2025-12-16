import type { Request, Response, NextFunction } from 'express'
import { auth } from '../config/firebase.js'

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string
    email?: string
    displayName?: string
  }
}

export async function authenticateToken (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' })
    return
  }

  const token = authHeader.split('Bearer ')[1]

  if (!token) {
    res.status(401).json({ error: 'No token provided' })
    return
  }

  try {
    const decodedToken = await auth.verifyIdToken(token)

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      displayName: decodedToken.name
    }

    next()
  } catch (error) {
    console.error('Token verification failed:', error)
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

