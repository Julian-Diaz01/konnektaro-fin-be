import 'dotenv/config'
import express from 'express'
import { setupSecurity } from './middleware/security.js'
import { authenticateToken, AuthenticatedRequest } from './middleware/auth.js'
import { getChart, getQuotes } from './routes/marketData.js'
import { getCurrentUser, createUser, updateUser, deleteUser } from './routes/users.js'
import { testConnection, closeConnection } from './services/testConnection.js'
import { createUserStock, deleteUserStock, getUserStocks } from './routes/userStocks.js'
import redisClient from './config/redis.js'

const app = express()
const PORT = process.env.PORT || 4040

app.use(express.json())
setupSecurity(app)

// Health check endpoint (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Market data endpoints
app.get('/api/market-data/stocks/chart', authenticateToken, getChart)
app.get('/api/market-data/stocks/quotes', authenticateToken, getQuotes)

// Portfolio endpoints
app.get('/api/portfolio/stocks', authenticateToken, getUserStocks)
app.post('/api/portfolio/stocks', authenticateToken, createUserStock)
app.delete('/api/portfolio/stocks/:id', authenticateToken, deleteUserStock)

// Protected routes
app.get('/api/user', authenticateToken, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user })
})

// User routes
app.get('/api/users/me', authenticateToken, getCurrentUser)
app.post('/api/users/me', authenticateToken, createUser)
app.put('/api/users/me', authenticateToken, updateUser)
app.delete('/api/users/me', authenticateToken, deleteUser)

// Start server
const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📋 Health check: http://localhost:${PORT}/health`)
  
  // Test database connection
  const dbTest = await testConnection()
  if (dbTest.success) {
    console.log('✅ Database connected:', dbTest.timestamp)
  } else {
    console.error('❌ Database connection failed:', dbTest.error)
  }
})

// Graceful shutdown
async function shutdown () {
  console.log('Shutting down gracefully...')
  server.close(async () => {
    console.log('HTTP server closed')
    await closeConnection()
    try {
      await redisClient.quit()
      console.log('Redis connection closed')
    } catch (error) {
      console.error('Error closing Redis connection:', error)
    }
    process.exit(0)
  })
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received')
  await shutdown()
})

process.on('SIGINT', async () => {
  console.log('SIGINT signal received')
  await shutdown()
})

