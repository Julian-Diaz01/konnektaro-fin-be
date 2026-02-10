import sql from '../config/database.js'
import { getQuotes } from '../utils/yahooRetry.js'
import { getChartDataAsQuotes } from './chartDataService.js'
import type { UserDailyStockResumePayload } from '../models/userDailyStockResume.js'

interface Holding {
  symbol: string
  quantity: number
  purchasePrice: number | null
}

function formatDate (d: Date): string {
  return d.toISOString().slice(0, 10)
}

function isSameDate (d1: Date, d2: Date): boolean {
  return formatDate(d1) === formatDate(d2)
}

/** Price cache: symbol -> dateStr -> price */
type PriceCache = Map<string, Map<string, number>>

async function buildPriceCache (
  symbols: string[],
  targetDates: string[]
): Promise<PriceCache> {
  const cache: PriceCache = new Map()
  const todayStr = formatDate(new Date())
  const pastDates = targetDates.filter((d) => d !== todayStr)

  if (symbols.length === 0) return cache

  if (targetDates.includes(todayStr)) {
    const quotes = await getQuotes(symbols)
    for (const q of quotes) {
      if (q.symbol && typeof q.regularMarketPrice === 'number' && Number.isFinite(q.regularMarketPrice)) {
        if (!cache.has(q.symbol)) cache.set(q.symbol, new Map())
        cache.get(q.symbol)!.set(todayStr, q.regularMarketPrice)
      }
    }
  }

  if (pastDates.length > 0) {
    const minDate = new Date(Math.min(...pastDates.map((d) => new Date(d).getTime())))
    const maxDate = new Date(Math.max(...pastDates.map((d) => new Date(d).getTime())))
    minDate.setDate(minDate.getDate() - 1)
    maxDate.setDate(maxDate.getDate() + 1)

    for (const symbol of symbols) {
      try {
        const chart = await getChartDataAsQuotes(symbol, '1d', minDate, maxDate)
        if (!cache.has(symbol)) cache.set(symbol, new Map())
        const symbolCache = cache.get(symbol)!
        for (const q of chart.quotes) {
          if (q.date && q.close != null && Number.isFinite(q.close)) {
            symbolCache.set(formatDate(q.date), q.close)
          }
        }
      } catch (err) {
        console.warn(`Could not fetch chart for ${symbol}:`, err)
      }
    }
  }

  return cache
}

function computeResumeFromCache (
  holdings: Holding[],
  targetDate: string,
  priceCache: PriceCache
): Omit<UserDailyStockResumePayload, 'uid'> {
  let totalInvested = 0
  let totalValue = 0

  for (const h of holdings) {
    const purchasePrice = h.purchasePrice ?? 0
    const price = priceCache.get(h.symbol)?.get(targetDate)
    const quantity = Number(h.quantity) || 0

    totalInvested += quantity * purchasePrice
    if (price != null && Number.isFinite(price)) {
      totalValue += quantity * price
    }
  }

  const totalPnlValue = totalValue - totalInvested
  const totalPnlPercent = totalInvested > 0 ? (totalPnlValue / totalInvested) * 100 : 0

  return {
    resumeDate: targetDate,
    totalInvested: Math.round(totalInvested * 10000) / 10000,
    totalValue: Math.round(totalValue * 10000) / 10000,
    totalPnlValue: Math.round(totalPnlValue * 10000) / 10000,
    totalPnlPercent: Math.round(totalPnlPercent * 10000) / 10000
  }
}

/**
 * Batch-compute resumes for multiple users and dates.
 * Fetches chart data once per symbol for the full date range (minimal Yahoo requests).
 */
export async function computeResumesBatch (
  uids: string[],
  targetDates: string[]
): Promise<Array<{ uid: string; date: string; data: Omit<UserDailyStockResumePayload, 'uid'> }>> {
  if (uids.length === 0 || targetDates.length === 0) return []

  const rows = await sql`
    SELECT uid, symbol, quantity, purchase_price
    FROM user_stocks
    WHERE uid = ANY(${uids})
  ` as unknown as Array<{ uid: string; symbol: string; quantity: number; purchase_price: number | null }>

  const holdingsByUid = new Map<string, Holding[]>()
  const allSymbols = new Set<string>()

  for (const r of rows) {
    if (!holdingsByUid.has(r.uid)) holdingsByUid.set(r.uid, [])
    holdingsByUid.get(r.uid)!.push({
      symbol: r.symbol,
      quantity: r.quantity,
      purchasePrice: r.purchase_price
    })
    allSymbols.add(r.symbol)
  }

  for (const uid of uids) {
    if (!holdingsByUid.has(uid)) holdingsByUid.set(uid, [])
  }

  const symbols = [...allSymbols]
  const priceCache = await buildPriceCache(symbols, targetDates)

  const results: Array<{ uid: string; date: string; data: Omit<UserDailyStockResumePayload, 'uid'> }> = []

  for (const uid of uids) {
    const holdings = holdingsByUid.get(uid) ?? []
    for (const targetDate of targetDates) {
      const data = computeResumeFromCache(holdings, targetDate, priceCache)
      results.push({ uid, date: targetDate, data })
    }
  }

  return results
}

export async function computeResume (uid: string, targetDate: string): Promise<Omit<UserDailyStockResumePayload, 'uid'>> {
  const rows = await sql`
    SELECT symbol, quantity, purchase_price
    FROM user_stocks
    WHERE uid = ${uid}
  `
  const holdings = rows as unknown as Array<{ symbol: string; quantity: number; purchase_price: number | null }>

  if (holdings.length === 0) {
    return {
      resumeDate: targetDate,
      totalInvested: 0,
      totalValue: 0,
      totalPnlValue: 0,
      totalPnlPercent: 0
    }
  }

  const todayStr = formatDate(new Date())
  const targetDateObj = new Date(targetDate)

  const priceMap = new Map<string, number>()

  if (targetDate === todayStr) {
    const symbols = [...new Set(holdings.map((h) => h.symbol))]
    const quotes = await getQuotes(symbols)
    for (const q of quotes) {
      if (q.symbol && typeof q.regularMarketPrice === 'number' && Number.isFinite(q.regularMarketPrice)) {
        priceMap.set(q.symbol, q.regularMarketPrice)
      }
    }
  } else {
    const period1 = new Date(targetDateObj)
    period1.setDate(period1.getDate() - 1)
    const period2 = new Date(targetDateObj)
    period2.setDate(period2.getDate() + 1)

    for (const h of holdings) {
      const symbol = h.symbol
      if (priceMap.has(symbol)) continue

      try {
        const chart = await getChartDataAsQuotes(symbol, '1d', period1, period2)
        const quote = chart.quotes.find((q) => q.date && isSameDate(q.date, targetDateObj))
        if (quote?.close != null && Number.isFinite(quote.close)) {
          priceMap.set(symbol, quote.close)
        }
      } catch (err) {
        console.warn(`Could not fetch chart for ${symbol} on ${targetDate}:`, err)
      }
    }
  }

  let totalInvested = 0
  let totalValue = 0

  for (const h of holdings) {
    const purchasePrice = h.purchase_price ?? 0
    const price = priceMap.get(h.symbol)
    const quantity = Number(h.quantity) || 0

    totalInvested += quantity * purchasePrice
    if (price != null && Number.isFinite(price)) {
      totalValue += quantity * price
    }
  }

  const totalPnlValue = totalValue - totalInvested
  const totalPnlPercent = totalInvested > 0
    ? (totalPnlValue / totalInvested) * 100
    : 0

  return {
    resumeDate: targetDate,
    totalInvested: Math.round(totalInvested * 10000) / 10000,
    totalValue: Math.round(totalValue * 10000) / 10000,
    totalPnlValue: Math.round(totalPnlValue * 10000) / 10000,
    totalPnlPercent: Math.round(totalPnlPercent * 10000) / 10000
  }
}

export function getTodayDateString (): string {
  return formatDate(new Date())
}
