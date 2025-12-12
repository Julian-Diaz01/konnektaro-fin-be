import 'dotenv/config'
import express from 'express'
import { setupSecurity } from './middleware/security.js'
import { authenticateToken, AuthenticatedRequest } from './middleware/auth.js'
import { getChart, getQuotes } from './routes/stocks.js'
import { testConnection, closePool } from './config/database.js'

const app = express()
const PORT = process.env.PORT || 4040

app.use(express.json())
setupSecurity(app)

// Health check endpoint (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Stocks endpoints
app.get('/api/stocks/chart', getChart) //TODO ADD AUTH
app.get('/api/stocks/quotes', getQuotes) //TODO ADD AUTH

// Protected routes
app.get('/api/user', authenticateToken, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user })
})

// Start server
const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📋 Health check: http://localhost:${PORT}/health`)
  
  // Test database connection
  await testConnection()
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server')
  server.close(async () => {
    console.log('HTTP server closed')
    await closePool()
    process.exit(0)
  })
})

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server')
  server.close(async () => {
    console.log('HTTP server closed')
    await closePool()
    process.exit(0)
  })
})

