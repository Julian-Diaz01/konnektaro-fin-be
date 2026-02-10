import type { Request, Response } from 'express'
import sql from '../config/database.js'
import {
  ensureUserDailyStockResumeTable,
  upsertUserDailyStockResume
} from '../repositories/userDailyStockResumeRepository.js'
import { computeResumesBatch, getTodayDateString } from '../services/portfolioResumeService.js'

const ADMIN_SECRET_HEADER = 'x-admin-secret'

function getLastNTradingDays (n: number): string[] {
  const dates: string[] = []
  const d = new Date()

  while (dates.length < n) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) {
      dates.push(d.toISOString().slice(0, 10))
    }
    d.setDate(d.getDate() - 1)
  }

  return dates
}

export async function dailyResumeGenerate (req: Request, res: Response): Promise<void> {
  const adminSecret = process.env.ADMIN_SECRET
  const providedSecret = req.headers[ADMIN_SECRET_HEADER] as string | undefined

  if (!adminSecret || providedSecret !== adminSecret) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const dateParam = req.query.date as string | undefined
  const daysParam = req.query.days as string | undefined

  let targetDates: string[]

  if (daysParam != null && daysParam.trim() !== '') {
    const days = parseInt(daysParam.trim(), 10)
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      res.status(400).json({ error: 'days must be a number between 1 and 90' })
      return
    }
    targetDates = getLastNTradingDays(days)
  } else {
    targetDates = [dateParam?.trim() || getTodayDateString()]
  }

  await ensureUserDailyStockResumeTable()

  try {
    const rows = await sql`SELECT uid FROM user_profiles` as unknown as Array<{ uid: string }>
    const uids = rows.map((r) => r.uid)

    const batchResults = await computeResumesBatch(uids, targetDates)

    const byDate = new Map<string, { processed: number; errors: number }>()
    for (const d of targetDates) {
      byDate.set(d, { processed: 0, errors: 0 })
    }

    let totalProcessed = 0
    let totalErrors = 0

    for (const { uid, date, data } of batchResults) {
      try {
        await upsertUserDailyStockResume(uid, date, data)
        byDate.get(date)!.processed++
        totalProcessed++
      } catch (err) {
        console.error(`Failed to persist resume for user ${uid} on ${date}:`, err)
        byDate.get(date)!.errors++
        totalErrors++
      }
    }

    const results = targetDates.map((date) => ({
      date,
      processed: byDate.get(date)!.processed,
      errors: byDate.get(date)!.errors
    }))

    res.json({
      ok: true,
      dates: targetDates,
      results,
      totalProcessed,
      totalErrors,
      usersCount: uids.length
    })
  } catch (error) {
    console.error('Error in daily resume generation:', error)
    res.status(500).json({ error: 'Failed to generate daily resumes' })
  }
}
