import { createClient } from 'redis'


const getRedisUrl = (): string => {
  const envUrl = process.env.REDIS_URL
  
  if (envUrl) {
    // If it's set to Docker service name but we're running locally, fix it
    if (envUrl.includes('redis://redis:') && process.env.DB_HOST === 'localhost') {
      return envUrl.replace('redis://redis:', 'redis://localhost:')
    }
    return envUrl
  }
  
  // Default to localhost for local development
  return 'redis://localhost:6379'
}

const redisUrl = getRedisUrl()
console.log(`🔗 Connecting to Redis at: ${redisUrl}`)

const redisClient = createClient({
  url: redisUrl,
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

