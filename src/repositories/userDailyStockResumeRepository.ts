import sql from '../config/database.js'
import type { UserDailyStockResumePayload } from '../models/userDailyStockResume.js'
import { mapRowToUserDailyStockResume, type UserDailyStockResume } from '../models/userDailyStockResume.js'

let isUserDailyStockResumeTableInitialized = false

export async function ensureUserDailyStockResumeTable (): Promise<void> {
  if (isUserDailyStockResumeTableInitialized) return

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`

  await sql`
    CREATE TABLE IF NOT EXISTS user_daily_stock_resume (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uid TEXT NOT NULL REFERENCES user_profiles(uid) ON DELETE CASCADE,
      resume_date DATE NOT NULL,
      total_invested NUMERIC(18, 4) NOT NULL DEFAULT 0,
      total_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
      total_pnl_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
      total_pnl_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (uid, resume_date)
    )
  `

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_daily_stock_resume_uid_date
    ON user_daily_stock_resume (uid, resume_date DESC)
  `

  isUserDailyStockResumeTableInitialized = true
}

export async function upsertUserDailyStockResume (
  uid: string,
  resumeDate: string,
  data: Omit<UserDailyStockResumePayload, 'uid' | 'resumeDate'>
): Promise<UserDailyStockResume> {
  const rows = await sql`
    INSERT INTO user_daily_stock_resume (uid, resume_date, total_invested, total_value, total_pnl_value, total_pnl_percent)
    VALUES (
      ${uid},
      ${resumeDate}::date,
      ${data.totalInvested},
      ${data.totalValue},
      ${data.totalPnlValue},
      ${data.totalPnlPercent}
    )
    ON CONFLICT (uid, resume_date) DO UPDATE SET
      total_invested = EXCLUDED.total_invested,
      total_value = EXCLUDED.total_value,
      total_pnl_value = EXCLUDED.total_pnl_value,
      total_pnl_percent = EXCLUDED.total_pnl_percent,
      updated_at = NOW()
    RETURNING *
  `
  return mapRowToUserDailyStockResume(rows[0] as Record<string, unknown>)
}

export async function getLatestResumeForUser (uid: string): Promise<UserDailyStockResume | null> {
  const rows = await sql`
    SELECT *
    FROM user_daily_stock_resume
    WHERE uid = ${uid}
    ORDER BY resume_date DESC
    LIMIT 1
  `
  if (rows.length === 0) return null
  return mapRowToUserDailyStockResume(rows[0] as Record<string, unknown>)
}

export async function getResumeForUserOnDate (uid: string, resumeDate: string): Promise<UserDailyStockResume | null> {
  const rows = await sql`
    SELECT *
    FROM user_daily_stock_resume
    WHERE uid = ${uid} AND resume_date = ${resumeDate}::date
  `
  if (rows.length === 0) return null
  return mapRowToUserDailyStockResume(rows[0] as Record<string, unknown>)
}

export async function getPreviousResumeForUser (uid: string, beforeDate: string): Promise<UserDailyStockResume | null> {
  const rows = await sql`
    SELECT *
    FROM user_daily_stock_resume
    WHERE uid = ${uid} AND resume_date < ${beforeDate}::date
    ORDER BY resume_date DESC
    LIMIT 1
  `
  if (rows.length === 0) return null
  return mapRowToUserDailyStockResume(rows[0] as Record<string, unknown>)
}
