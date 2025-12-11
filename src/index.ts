import 'dotenv/config'
import express from 'express'
import { setupSecurity } from './middleware/security.js'
import { authenticateToken, AuthenticatedRequest } from './middleware/auth.js'

const app = express()
const PORT = process.env.PORT || 4040

app.use(express.json())
setupSecurity(app)

// Health check endpoint (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Protected routes
app.get('/api/user', authenticateToken, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📋 Health check: http://localhost:${PORT}/health`)
})

