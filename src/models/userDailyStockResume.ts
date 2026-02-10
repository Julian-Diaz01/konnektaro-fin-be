export interface UserDailyStockResume {
  id: string
  uid: string
  resumeDate: string
  totalInvested: number
  totalValue: number
  totalPnlValue: number
  totalPnlPercent: number
  createdAt: Date
  updatedAt: Date
}

export interface UserDailyStockResumePayload {
  uid: string
  resumeDate: string
  totalInvested: number
  totalValue: number
  totalPnlValue: number
  totalPnlPercent: number
}

export function mapRowToUserDailyStockResume (row: Record<string, unknown>): UserDailyStockResume {
  return {
    id: row.id as string,
    uid: row.uid as string,
    resumeDate: (row.resume_date instanceof Date ? row.resume_date.toISOString().slice(0, 10) : String(row.resume_date)),
    totalInvested: Number(row.total_invested ?? 0),
    totalValue: Number(row.total_value ?? 0),
    totalPnlValue: Number(row.total_pnl_value ?? 0),
    totalPnlPercent: Number(row.total_pnl_percent ?? 0),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date
  }
}
