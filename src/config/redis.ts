import { createClient } from 'redis'

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('❌ Redis: Too many reconnection attempts')
        return false
      }
      return Math.min(retries * 100, 3000)
    }
  }
})

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err)
})

redisClient.on('connect', () => {
  console.log('✅ Redis connected')
})

// Connect to Redis (non-blocking)
redisClient.connect().catch((err) => {
  console.error('❌ Failed to connect to Redis:', err)
  console.warn('⚠️  Application will continue without Redis cache')
})

export default redisClient

