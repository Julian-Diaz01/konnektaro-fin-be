import type { Response } from 'express'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import {
  ensureUserDailyStockResumeTable,
  getResumeForUserOnDate,
  getPreviousResumeForUser,
  upsertUserDailyStockResume
} from '../repositories/userDailyStockResumeRepository.js'
import { computeResume, getTodayDateString } from '../services/portfolioResumeService.js'

interface ResumeOverviewItem {
  date: string
  totalInvested: number
  totalValue: number
  totalPnlValue: number
  totalPnlPercent: number
}

export async function getDashboardOverview (req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user?.uid) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const uid = req.user.uid

  await ensureUserDailyStockResumeTable()

  try {
    const todayStr = getTodayDateString()

    let todayResume = await getResumeForUserOnDate(uid, todayStr)
    if (!todayResume) {
      const computed = await computeResume(uid, todayStr)
      todayResume = await upsertUserDailyStockResume(uid, todayStr, computed)
    }

    const yesterdayResume = await getPreviousResumeForUser(uid, todayStr)

    const today: ResumeOverviewItem = {
      date: todayResume.resumeDate,
      totalInvested: todayResume.totalInvested,
      totalValue: todayResume.totalValue,
      totalPnlValue: todayResume.totalPnlValue,
      totalPnlPercent: todayResume.totalPnlPercent
    }

    const yesterday: ResumeOverviewItem | null = yesterdayResume
      ? {
          date: yesterdayResume.resumeDate,
          totalInvested: yesterdayResume.totalInvested,
          totalValue: yesterdayResume.totalValue,
          totalPnlValue: yesterdayResume.totalPnlValue,
          totalPnlPercent: yesterdayResume.totalPnlPercent
        }
      : null

    const deltas = yesterdayResume
      ? {
          deltaValue: Math.round((todayResume.totalValue - yesterdayResume.totalValue) * 10000) / 10000,
          deltaPnlValue: Math.round((todayResume.totalPnlValue - yesterdayResume.totalPnlValue) * 10000) / 10000,
          deltaPnlPercent: Math.round((todayResume.totalPnlPercent - yesterdayResume.totalPnlPercent) * 10000) / 10000
        }
      : { deltaValue: null, deltaPnlValue: null, deltaPnlPercent: null }

    res.json({ today, yesterday, deltas })
  } catch (error) {
    console.error('Error fetching dashboard overview:', error)
    res.status(500).json({ error: 'Failed to fetch dashboard overview' })
  }
}
