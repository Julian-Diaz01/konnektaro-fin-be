import redisClient from '../config/redis.js'

const CACHE_TTL_SECONDS = 15 * 60 // 15 minutes

export async function getCache<T> (key: string): Promise<T | null> {
  try {
    const value = await redisClient.get(key)
    if (value) {
      return JSON.parse(value) as T
    }
    return null
  } catch (error) {
    console.error(`Error getting cache for key ${key}:`, error)
    return null
  }
}


export async function setCache<T> (key: string, value: T): Promise<void> {
  try {
    await redisClient.setEx(key, CACHE_TTL_SECONDS, JSON.stringify(value))
  } catch (error) {
    console.error(`Error setting cache for key ${key}:`, error)
  }
}


export function getChartCacheKey (symbol: string, interval: string, range: string): string {
  return `yahoo:chart:${symbol}:${interval}:${range}`
}

export function getQuoteCacheKey (symbols: string[]): string {
  // Sort symbols to ensure consistent cache keys
  const sortedSymbols = [...symbols].sort().join(',')
  return `yahoo:quote:${sortedSymbols}`
}

