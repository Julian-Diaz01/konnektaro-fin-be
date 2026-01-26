import YahooFinance from 'yahoo-finance2'
import redisClient from '../config/redis.js'

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

const MAX_REQUESTS_PER_MINUTE = 3
const RATE_LIMIT_KEY = 'yahoo:rate_limit:requests'
const MAX_RETRIES = 8
const RETRY_DELAY_MS = 2000

async function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRateLimitError (error: any): boolean {
  return error?.status === 429 || 
         error?.message?.includes('429') || 
         error?.message?.includes('Too Many Requests') ||
         error?.message?.includes('Failed to get crumb')
}

async function enforceRateLimit (): Promise<void> {
  try {
    const count = parseInt(await redisClient.get(RATE_LIMIT_KEY) || '0', 10)
    
    if (count >= MAX_REQUESTS_PER_MINUTE) {
      const ttl = await redisClient.ttl(RATE_LIMIT_KEY)
      const waitTime = ttl > 0 ? (ttl * 1000) + 500 : 60000
      console.log(`⏳ Rate limit reached. Waiting ${Math.round(waitTime)}ms...`)
      await sleep(waitTime)
      return await enforceRateLimit()
    }
    
    if (count === 0) {
      await redisClient.setEx(RATE_LIMIT_KEY, 60, '1')
    } else {
      await redisClient.incr(RATE_LIMIT_KEY)
    }
    
    await sleep(3000)
  } catch (error) {
    console.warn('⚠️  Rate limit check failed, adding safety delay:', error)
    await sleep(500)
  }
}

async function executeWithRetry<T> (operation: () => Promise<T>): Promise<T> {
  await enforceRateLimit()
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      if (isRateLimitError(error) && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt)
        console.warn(`🔄 Rate limit error (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${Math.round(delay)}ms...`)
        await sleep(delay)
        continue
      }
      throw error
    }
  }
  throw new Error('Max retries exceeded')
}

export async function getQuotes (symbols: string[]): Promise<Array<{
  symbol: string
  regularMarketPrice?: number
  regularMarketChange?: number
  regularMarketChangePercent?: number
}>> {
  return await executeWithRetry(async () => {
    return await yahooFinance.quote(symbols) as Array<{
      symbol: string
      regularMarketPrice?: number
      regularMarketChange?: number
      regularMarketChangePercent?: number
    }>
  })
}

export async function getChart (
  symbol: string,
  options: {
    interval: '1d' | '5m' | '1h' | '15m' | '30m' | '60m' | '1wk' | '1mo'
    period1: Date
    period2: Date
  }
): Promise<{ quotes: Array<{ date: Date; close: number | null }> }> {
  return await executeWithRetry(async () => {
    const result = await yahooFinance.chart(symbol, {
      ...options,
      return: 'array' as const
    })
    return result as { quotes: Array<{ date: Date; close: number | null }> }
  })
}
