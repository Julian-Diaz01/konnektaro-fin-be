import type { Request, Response } from 'express'
import yahooFinance from 'yahoo-finance2'

function getStartDate (range: string): Date {
  const now = new Date()
  switch (range) {
    case '1d':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000)
    case '5d':
      return new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
    case '1mo':
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    case '6mo':
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
    case 'ytd':
      return new Date(now.getFullYear(), 0, 1)
    case '1y':
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    default:
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
  }
}

export async function getChart (req: Request, res: Response): Promise<void> {
  const symbol = req.query.symbol as string
  const interval = (req.query.interval as string) || '1d'
  const range = (req.query.range as string) || '1mo'

  if (!symbol) {
    res.status(400).json({ error: 'Symbol parameter is required' })
    return
  }

  try {
    const startDate = getStartDate(range)
    const result = await yahooFinance.chart(symbol, {
      interval: interval as '1d' | '5m' | '1h' | '15m' | '30m' | '60m' | '1wk' | '1mo',
      period1: startDate,
      period2: new Date()
    })

    const data = {
      timestamp: result.quotes.map(q => Math.floor(q.date.getTime() / 1000)),
      closes: result.quotes.map(q => q.close ?? null)
    }

    res.json(data)
  } catch (error) {
    console.error(`Error fetching chart for ${symbol}:`, error)
    res.status(500).json({ error: 'Failed to fetch chart data' })
  }
}

export async function getQuotes (req: Request, res: Response): Promise<void> {
  const symbolsParam = req.query.symbols as string

  if (!symbolsParam) {
    res.status(400).json({ error: 'Symbols parameter is required' })
    return
  }

  const symbols = symbolsParam.split(',').filter(s => s.trim())

  try {
    const results = await yahooFinance.quote(symbols)
    const quotes = Array.isArray(results) ? results : [results]

    const data = quotes.map((q: any) => ({
      symbol: q.symbol,
      regularMarketPrice: q.regularMarketPrice,
      regularMarketChange: q.regularMarketChange,
      regularMarketChangePercent: q.regularMarketChangePercent
    }))

    res.json({ quotes: data })
  } catch (error) {
    console.error('Error fetching quotes:', error)
    res.status(500).json({ error: 'Failed to fetch quotes' })
  }
}

