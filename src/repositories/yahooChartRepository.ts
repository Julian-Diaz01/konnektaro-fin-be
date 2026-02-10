import sql from '../config/database.js'

export interface YahooChartSeries {
  symbol: string
  interval: string
  oldestDate: Date | null
  newestDate: Date | null
  updatedAt: Date
}

export interface YahooChartPoint {
  symbol: string
  interval: string
  tradeDate: Date
  close: number | null
}

let isYahooChartTablesInitialized = false

export async function ensureYahooChartTables (): Promise<void> {
  if (isYahooChartTablesInitialized) return

  await sql`
    CREATE TABLE IF NOT EXISTS yahoo_chart_series (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      oldest_date DATE,
      newest_date DATE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (symbol, interval)
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS yahoo_chart_points (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      trade_date DATE NOT NULL,
      close NUMERIC(18, 4),
      PRIMARY KEY (symbol, interval, trade_date),
      FOREIGN KEY (symbol, interval) REFERENCES yahoo_chart_series(symbol, interval) ON DELETE CASCADE
    )
  `

  await sql`
    CREATE INDEX IF NOT EXISTS idx_yahoo_chart_points_symbol_interval_date
    ON yahoo_chart_points (symbol, interval, trade_date DESC)
  `

  await sql`
    CREATE INDEX IF NOT EXISTS idx_yahoo_chart_series_symbol_interval
    ON yahoo_chart_series (symbol, interval)
  `

  isYahooChartTablesInitialized = true
}

export async function getStoredRange (
  symbol: string,
  interval: string
): Promise<{ oldestDate: Date | null; newestDate: Date | null } | null> {
  await ensureYahooChartTables()

  const rows = await sql`
    SELECT oldest_date, newest_date
    FROM yahoo_chart_series
    WHERE symbol = ${symbol} AND interval = ${interval}
  `

  if (rows.length === 0) return null

  const row = rows[0] as { oldest_date: Date | null; newest_date: Date | null }
  return {
    oldestDate: row.oldest_date,
    newestDate: row.newest_date
  }
}

export async function getPoints (
  symbol: string,
  interval: string,
  period1: Date,
  period2: Date
): Promise<Array<{ date: Date; close: number | null }>> {
  await ensureYahooChartTables()

  const rows = await sql`
    SELECT trade_date, close
    FROM yahoo_chart_points
    WHERE symbol = ${symbol}
      AND interval = ${interval}
      AND trade_date >= ${period1}::date
      AND trade_date <= ${period2}::date
    ORDER BY trade_date ASC
  ` as unknown as Array<{ trade_date: Date; close: number | null }>

  return rows.map((row) => ({
    date: row.trade_date,
    close: row.close
  }))
}

export async function insertPoints (
  symbol: string,
  interval: string,
  points: Array<{ date: Date; close: number | null }>
): Promise<void> {
  if (points.length === 0) return

  await ensureYahooChartTables()

  // Ensure series exists first
  await sql`
    INSERT INTO yahoo_chart_series (symbol, interval, oldest_date, newest_date)
    VALUES (${symbol}, ${interval}, NULL, NULL)
    ON CONFLICT (symbol, interval) DO NOTHING
  `

  // Insert points with idempotent conflict handling (skip invalid dates)
  for (const point of points) {
    const d = point.date instanceof Date ? point.date : new Date(point.date as unknown as string | number)
    if (Number.isNaN(d.getTime())) continue
    const dateStr = d.toISOString().slice(0, 10) // YYYY-MM-DD
    await sql`
      INSERT INTO yahoo_chart_points (symbol, interval, trade_date, close)
      VALUES (${symbol}, ${interval}, ${dateStr}::date, ${point.close})
      ON CONFLICT (symbol, interval, trade_date) DO UPDATE SET
        close = EXCLUDED.close
    `
  }
}

export async function updateRange (
  symbol: string,
  interval: string,
  oldestDate: Date | null,
  newestDate: Date | null
): Promise<void> {
  await ensureYahooChartTables()

  // Use LEAST/GREATEST for safe concurrent updates
  await sql`
    UPDATE yahoo_chart_series
    SET 
      oldest_date = CASE 
        WHEN oldest_date IS NULL THEN ${oldestDate}::date
        WHEN ${oldestDate}::date IS NULL THEN oldest_date
        ELSE LEAST(oldest_date, ${oldestDate}::date)
      END,
      newest_date = CASE 
        WHEN newest_date IS NULL THEN ${newestDate}::date
        WHEN ${newestDate}::date IS NULL THEN newest_date
        ELSE GREATEST(newest_date, ${newestDate}::date)
      END,
      updated_at = NOW()
    WHERE symbol = ${symbol} AND interval = ${interval}
  `
}

export async function initializeSeriesRange (
  symbol: string,
  interval: string,
  oldestDate: Date,
  newestDate: Date
): Promise<void> {
  await ensureYahooChartTables()

  await sql`
    INSERT INTO yahoo_chart_series (symbol, interval, oldest_date, newest_date)
    VALUES (${symbol}, ${interval}, ${oldestDate}::date, ${newestDate}::date)
    ON CONFLICT (symbol, interval) DO UPDATE SET
      oldest_date = LEAST(yahoo_chart_series.oldest_date, EXCLUDED.oldest_date),
      newest_date = GREATEST(yahoo_chart_series.newest_date, EXCLUDED.newest_date),
      updated_at = NOW()
  `
}
