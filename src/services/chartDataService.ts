import { getChart as fetchChartFromYahoo } from '../utils/yahooRetry.js'
import {
  ensureYahooChartTables,
  getStoredRange,
  getPoints,
  insertPoints,
  updateRange,
  initializeSeriesRange
} from '../repositories/yahooChartRepository.js'
import redisClient from '../config/redis.js'

const BACKFILL_LOCK_TTL_SECONDS = 300 // 5 minutes
const NO_OLDER_DATA_TTL_SECONDS = 86400 // 24 hours

function formatDate (date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays (date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function getDateOnly (date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Normalize quote date to Date; filter out invalid entries */
function sanitizeQuotes (quotes: Array<{ date: Date; close: number | null }>): Array<{ date: Date; close: number | null }> {
  return quotes
    .filter((q) => q != null && q.date != null)
    .map((q) => {
      const date = q.date instanceof Date ? q.date : new Date(q.date as unknown as string | number)
      const time = date.getTime()
      if (Number.isNaN(time)) return null
      return { date: new Date(time), close: q.close ?? null }
    })
    .filter((q): q is { date: Date; close: number | null } => q != null)
}

async function acquireBackfillLock (symbol: string, interval: string): Promise<boolean> {
  try {
    const lockKey = `yahoo:backfill_lock:${symbol}:${interval}`
    const result = await redisClient.setNX(lockKey, '1')
    if (result === 1) {
      await redisClient.expire(lockKey, BACKFILL_LOCK_TTL_SECONDS)
      return true
    }
    return false
  } catch (error) {
    console.warn(`Failed to acquire backfill lock for ${symbol}:${interval}:`, error)
    return false // Continue anyway, DB inserts are idempotent
  }
}

async function releaseBackfillLock (symbol: string, interval: string): Promise<void> {
  try {
    const lockKey = `yahoo:backfill_lock:${symbol}:${interval}`
    await redisClient.del(lockKey)
  } catch (error) {
    console.warn(`Failed to release backfill lock for ${symbol}:${interval}:`, error)
  }
}

async function checkNoOlderData (symbol: string, interval: string): Promise<boolean> {
  try {
    const key = `yahoo:no_older:${symbol}:${interval}`
    const value = await redisClient.get(key)
    return value !== null
  } catch (error) {
    return false
  }
}

async function setNoOlderData (symbol: string, interval: string): Promise<void> {
  try {
    const key = `yahoo:no_older:${symbol}:${interval}`
    await redisClient.setEx(key, NO_OLDER_DATA_TTL_SECONDS, '1')
  } catch (error) {
    console.warn(`Failed to set no older data flag for ${symbol}:${interval}:`, error)
  }
}

function mergePoints (
  existing: Array<{ date: Date; close: number | null }>,
  newPoints: Array<{ date: Date; close: number | null }>
): Array<{ date: Date; close: number | null }> {
  const map = new Map<string, { date: Date; close: number | null }>()

  // Add existing points
  for (const point of existing) {
    const key = formatDate(point.date)
    map.set(key, point)
  }

  // Add/update with new points
  for (const point of newPoints) {
    const key = formatDate(point.date)
    map.set(key, point)
  }

  // Sort by date
  return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
}

export async function getChartData (
  symbol: string,
  interval: '1d' | '5m' | '1h' | '15m' | '30m' | '60m' | '1wk' | '1mo',
  period1: Date,
  period2: Date
): Promise<{ timestamp: number[]; closes: (number | null)[] }> {
  // Ensure tables are initialized first
  await ensureYahooChartTables()

  const normalizedPeriod1 = getDateOnly(period1)
  const normalizedPeriod2 = getDateOnly(period2)

  // Get stored range from DB
  const storedRange = await getStoredRange(symbol, interval)

  if (!storedRange) {
    // First request for this symbol+interval - fetch everything
    console.log(`First request for ${symbol}:${interval}, fetching full range`)
    let chartData: { quotes: Array<{ date: Date; close: number | null }> }
    try {
      chartData = await fetchChartFromYahoo(symbol, {
        interval,
        period1: normalizedPeriod1,
        period2: normalizedPeriod2
      })
    } catch (err) {
      console.error(`Yahoo chart fetch failed for ${symbol}:`, err)
      throw err
    }

    const quotes = Array.isArray(chartData?.quotes) ? sanitizeQuotes(chartData.quotes) : []

    if (quotes.length === 0) {
      // No data available - return empty (don't throw)
      return { timestamp: [], closes: [] }
    }

    // Insert all points
    await insertPoints(symbol, interval, quotes)

    // Initialize series range
    const dates = quotes.map(q => q.date)
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))
    await initializeSeriesRange(symbol, interval, minDate, maxDate)

    // Return formatted data
    return {
      timestamp: quotes.map((q) => Math.floor(q.date.getTime() / 1000)),
      closes: quotes.map((q) => q.close ?? null)
    }
  }

  // We have stored data - check what we need
  const { oldestDate, newestDate } = storedRange
  
  // First, try to get data from DB for the requested range
  const dbPoints = await getPoints(symbol, interval, normalizedPeriod1, normalizedPeriod2)
  
  // Check if we have complete coverage
  const hasCompleteCoverage = oldestDate != null && 
                                newestDate != null && 
                                normalizedPeriod1 >= oldestDate && 
                                normalizedPeriod2 <= newestDate &&
                                dbPoints.length > 0
  
  if (hasCompleteCoverage) {
    // We have all data in DB, no Yahoo call needed
    console.log(`✅ Serving ${symbol}:${interval} from DB (${dbPoints.length} points)`)
    return {
      timestamp: dbPoints.map((p) => Math.floor(p.date.getTime() / 1000)),
      closes: dbPoints.map((p) => p.close ?? null)
    }
  }
  
  // We need to fetch missing data from Yahoo
  const needOlder = oldestDate == null || normalizedPeriod1 < oldestDate
  const needNewer = newestDate == null || normalizedPeriod2 > newestDate
  
  console.log(`⚠️  ${symbol}:${interval} - DB range: [${oldestDate?.toISOString() || 'null'}, ${newestDate?.toISOString() || 'null'}], requested: [${normalizedPeriod1.toISOString()}, ${normalizedPeriod2.toISOString()}], needOlder: ${needOlder}, needNewer: ${needNewer}`)

  let pointsToMerge: Array<{ date: Date; close: number | null }> = []

  // Fetch older data if needed
  if (needOlder && oldestDate != null) {
    // Check if we've already determined no older data exists
    if (await checkNoOlderData(symbol, interval)) {
      console.log(`Skipping older data fetch for ${symbol}:${interval} - flagged as no older data`)
    } else {
      const backfillStart = normalizedPeriod1
      const backfillEnd = addDays(oldestDate, -1)

      if (backfillStart <= backfillEnd) {
        const lockAcquired = await acquireBackfillLock(symbol, interval)
        if (lockAcquired) {
          try {
            console.log(`Fetching older data for ${symbol}:${interval} from ${formatDate(backfillStart)} to ${formatDate(backfillEnd)}`)
            const olderResult = await fetchChartFromYahoo(symbol, {
              interval,
              period1: backfillStart,
              period2: backfillEnd
            })
            const olderQuotes = sanitizeQuotes(olderResult?.quotes ?? [])

            if (olderQuotes.length === 0) {
              await setNoOlderData(symbol, interval)
            } else {
              await insertPoints(symbol, interval, olderQuotes)
              pointsToMerge.push(...olderQuotes)

              const oldestFetched = new Date(Math.min(...olderQuotes.map(q => q.date.getTime())))
              await updateRange(symbol, interval, oldestFetched, null)
            }
          } catch (err) {
            console.warn(`Yahoo older backfill failed for ${symbol}:${interval}, using DB data only:`, err)
          } finally {
            await releaseBackfillLock(symbol, interval)
          }
        } else {
          console.log(`Backfill lock already held for ${symbol}:${interval}, skipping older fetch`)
        }
      }
    }
  }

  // Fetch newer data if needed
  if (needNewer && newestDate != null) {
    const backfillStart = addDays(newestDate, 1)
    const backfillEnd = normalizedPeriod2

    if (backfillStart <= backfillEnd) {
      const lockAcquired = await acquireBackfillLock(symbol, interval)
      if (lockAcquired) {
        try {
          console.log(`Fetching newer data for ${symbol}:${interval} from ${formatDate(backfillStart)} to ${formatDate(backfillEnd)}`)
          const newerResult = await fetchChartFromYahoo(symbol, {
            interval,
            period1: backfillStart,
            period2: backfillEnd
          })
          const newerQuotes = sanitizeQuotes(newerResult?.quotes ?? [])

          if (newerQuotes.length > 0) {
            await insertPoints(symbol, interval, newerQuotes)
            pointsToMerge.push(...newerQuotes)

            const newestFetched = new Date(Math.max(...newerQuotes.map(q => q.date.getTime())))
            await updateRange(symbol, interval, null, newestFetched)
          }
        } catch (err) {
          console.warn(`Yahoo newer backfill failed for ${symbol}:${interval}, using DB data only:`, err)
        } finally {
          await releaseBackfillLock(symbol, interval)
        }
      } else {
        console.log(`Backfill lock already held for ${symbol}:${interval}, skipping newer fetch`)
      }
    }
  }

  // If we need data but oldestDate is null (initial state), fetch everything
  if (needOlder && oldestDate == null) {
    const lockAcquired = await acquireBackfillLock(symbol, interval)
    if (lockAcquired) {
      try {
        console.log(`Fetching initial older data for ${symbol}:${interval}`)
        const olderResult = await fetchChartFromYahoo(symbol, {
          interval,
          period1: normalizedPeriod1,
          period2: normalizedPeriod2 < newestDate! ? normalizedPeriod2 : addDays(newestDate!, -1)
        })
        const olderQuotes = sanitizeQuotes(olderResult?.quotes ?? [])

        if (olderQuotes.length > 0) {
          await insertPoints(symbol, interval, olderQuotes)
          pointsToMerge.push(...olderQuotes)

          const oldestFetched = new Date(Math.min(...olderQuotes.map(q => q.date.getTime())))
          await updateRange(symbol, interval, oldestFetched, null)
        }
      } catch (err) {
        console.warn(`Yahoo initial older backfill failed for ${symbol}:${interval}:`, err)
      } finally {
        await releaseBackfillLock(symbol, interval)
      }
    }
  }

  if (needNewer && newestDate == null) {
    const lockAcquired = await acquireBackfillLock(symbol, interval)
    if (lockAcquired) {
      try {
        console.log(`Fetching initial newer data for ${symbol}:${interval}`)
        const newerResult = await fetchChartFromYahoo(symbol, {
          interval,
          period1: normalizedPeriod1 > oldestDate! ? normalizedPeriod1 : addDays(oldestDate!, 1),
          period2: normalizedPeriod2
        })
        const newerQuotes = sanitizeQuotes(newerResult?.quotes ?? [])

        if (newerQuotes.length > 0) {
          await insertPoints(symbol, interval, newerQuotes)
          pointsToMerge.push(...newerQuotes)

          const newestFetched = new Date(Math.max(...newerQuotes.map(q => q.date.getTime())))
          await updateRange(symbol, interval, null, newestFetched)
        }
      } catch (err) {
        console.warn(`Yahoo initial newer backfill failed for ${symbol}:${interval}:`, err)
      } finally {
        await releaseBackfillLock(symbol, interval)
      }
    }
  }

  // Get all points from DB for the requested range (refresh after potential inserts)
  const refreshedDbPoints = await getPoints(symbol, interval, normalizedPeriod1, normalizedPeriod2)

  // Merge with any newly fetched points
  const allPoints = mergePoints(refreshedDbPoints, pointsToMerge)

  // Filter to requested range and sort
  const filteredPoints = allPoints.filter(
    p => p.date >= normalizedPeriod1 && p.date <= normalizedPeriod2
  ).sort((a, b) => a.date.getTime() - b.date.getTime())

  console.log(`📊 ${symbol}:${interval} - Returning ${filteredPoints.length} points (${refreshedDbPoints.length} from DB, ${pointsToMerge.length} newly fetched)`)

  return {
    timestamp: filteredPoints.map((p) => Math.floor(p.date.getTime() / 1000)),
    closes: filteredPoints.map((p) => p.close ?? null)
  }
}

/**
 * Get chart data in quotes format (for internal use, e.g., portfolioResumeService)
 * Returns the same format as yahooRetry.getChart for compatibility
 */
export async function getChartDataAsQuotes (
  symbol: string,
  interval: '1d' | '5m' | '1h' | '15m' | '30m' | '60m' | '1wk' | '1mo',
  period1: Date,
  period2: Date
): Promise<{ quotes: Array<{ date: Date; close: number | null }> }> {
  // Ensure tables are initialized first
  await ensureYahooChartTables()

  const normalizedPeriod1 = getDateOnly(period1)
  const normalizedPeriod2 = getDateOnly(period2)

  // Get stored range from DB
  const storedRange = await getStoredRange(symbol, interval)

  if (!storedRange) {
    // First request for this symbol+interval - fetch everything
    console.log(`First request for ${symbol}:${interval}, fetching full range`)
    let chartData: { quotes: Array<{ date: Date; close: number | null }> }
    try {
      chartData = await fetchChartFromYahoo(symbol, {
        interval,
        period1: normalizedPeriod1,
        period2: normalizedPeriod2
      })
    } catch (err) {
      console.error(`Yahoo chart fetch failed for ${symbol} (getChartDataAsQuotes):`, err)
      throw err
    }
    const quotes = Array.isArray(chartData?.quotes) ? sanitizeQuotes(chartData.quotes) : []

    if (quotes.length === 0) {
      return { quotes: [] }
    }

    // Insert all points
    await insertPoints(symbol, interval, quotes)

    // Initialize series range
    const dates = quotes.map(q => q.date)
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))
    await initializeSeriesRange(symbol, interval, minDate, maxDate)

    return { quotes }
  }

  // We have stored data - check what we need
  const { oldestDate, newestDate } = storedRange
  const needOlder = oldestDate == null || normalizedPeriod1 < oldestDate
  const needNewer = newestDate == null || normalizedPeriod2 > newestDate

  let pointsToMerge: Array<{ date: Date; close: number | null }> = []

  // Fetch older data if needed
  if (needOlder && oldestDate != null) {
    if (await checkNoOlderData(symbol, interval)) {
      console.log(`Skipping older data fetch for ${symbol}:${interval} - flagged as no older data`)
    } else {
      const backfillStart = normalizedPeriod1
      const backfillEnd = addDays(oldestDate, -1)

      if (backfillStart <= backfillEnd) {
        const lockAcquired = await acquireBackfillLock(symbol, interval)
        if (lockAcquired) {
          try {
            console.log(`Fetching older data for ${symbol}:${interval} from ${formatDate(backfillStart)} to ${formatDate(backfillEnd)}`)
            const olderResult = await fetchChartFromYahoo(symbol, {
              interval,
              period1: backfillStart,
              period2: backfillEnd
            })
            const olderQuotes = sanitizeQuotes(olderResult?.quotes ?? [])

            if (olderQuotes.length === 0) {
              await setNoOlderData(symbol, interval)
            } else {
              await insertPoints(symbol, interval, olderQuotes)
              pointsToMerge.push(...olderQuotes)

              const oldestFetched = new Date(Math.min(...olderQuotes.map(q => q.date.getTime())))
              await updateRange(symbol, interval, oldestFetched, null)
            }
          } catch (err) {
            console.warn(`Yahoo older backfill failed for ${symbol}:${interval} (getChartDataAsQuotes):`, err)
          } finally {
            await releaseBackfillLock(symbol, interval)
          }
        }
      }
    }
  }

  // Fetch newer data if needed
  if (needNewer && newestDate != null) {
    const backfillStart = addDays(newestDate, 1)
    const backfillEnd = normalizedPeriod2

    if (backfillStart <= backfillEnd) {
      const lockAcquired = await acquireBackfillLock(symbol, interval)
      if (lockAcquired) {
        try {
          console.log(`Fetching newer data for ${symbol}:${interval} from ${formatDate(backfillStart)} to ${formatDate(backfillEnd)}`)
          const newerResult = await fetchChartFromYahoo(symbol, {
            interval,
            period1: backfillStart,
            period2: backfillEnd
          })
          const newerQuotes = sanitizeQuotes(newerResult?.quotes ?? [])

          if (newerQuotes.length > 0) {
            await insertPoints(symbol, interval, newerQuotes)
            pointsToMerge.push(...newerQuotes)

            const newestFetched = new Date(Math.max(...newerQuotes.map(q => q.date.getTime())))
            await updateRange(symbol, interval, null, newestFetched)
          }
        } catch (err) {
          console.warn(`Yahoo newer backfill failed for ${symbol}:${interval} (getChartDataAsQuotes):`, err)
        } finally {
          await releaseBackfillLock(symbol, interval)
        }
      }
    }
  }

  // Handle null oldest/newest cases
  if (needOlder && oldestDate == null) {
    const lockAcquired = await acquireBackfillLock(symbol, interval)
    if (lockAcquired) {
      try {
        console.log(`Fetching initial older data for ${symbol}:${interval}`)
        const olderResult = await fetchChartFromYahoo(symbol, {
          interval,
          period1: normalizedPeriod1,
          period2: normalizedPeriod2 < newestDate! ? normalizedPeriod2 : addDays(newestDate!, -1)
        })
        const olderQuotes = sanitizeQuotes(olderResult?.quotes ?? [])

        if (olderQuotes.length > 0) {
          await insertPoints(symbol, interval, olderQuotes)
          pointsToMerge.push(...olderQuotes)

          const oldestFetched = new Date(Math.min(...olderQuotes.map(q => q.date.getTime())))
          await updateRange(symbol, interval, oldestFetched, null)
        }
      } catch (err) {
        console.warn(`Yahoo initial older backfill failed for ${symbol}:${interval} (getChartDataAsQuotes):`, err)
      } finally {
        await releaseBackfillLock(symbol, interval)
      }
    }
  }

  if (needNewer && newestDate == null) {
    const lockAcquired = await acquireBackfillLock(symbol, interval)
    if (lockAcquired) {
      try {
        console.log(`Fetching initial newer data for ${symbol}:${interval}`)
        const newerResult = await fetchChartFromYahoo(symbol, {
          interval,
          period1: normalizedPeriod1 > oldestDate! ? normalizedPeriod1 : addDays(oldestDate!, 1),
          period2: normalizedPeriod2
        })
        const newerQuotes = sanitizeQuotes(newerResult?.quotes ?? [])

        if (newerQuotes.length > 0) {
          await insertPoints(symbol, interval, newerQuotes)
          pointsToMerge.push(...newerQuotes)

          const newestFetched = new Date(Math.max(...newerQuotes.map(q => q.date.getTime())))
          await updateRange(symbol, interval, null, newestFetched)
        }
      } catch (err) {
        console.warn(`Yahoo initial newer backfill failed for ${symbol}:${interval} (getChartDataAsQuotes):`, err)
      } finally {
        await releaseBackfillLock(symbol, interval)
      }
    }
  }

  // Get all points from DB for the requested range
  const dbPoints = await getPoints(symbol, interval, normalizedPeriod1, normalizedPeriod2)

  // Merge with any newly fetched points
  const allPoints = mergePoints(dbPoints, pointsToMerge)

  // Filter to requested range and sort
  const filteredPoints = allPoints.filter(
    p => p.date >= normalizedPeriod1 && p.date <= normalizedPeriod2
  ).sort((a, b) => a.date.getTime() - b.date.getTime())

  return {
    quotes: filteredPoints
  }
}
