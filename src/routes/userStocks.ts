import type { Response } from 'express'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import sql from '../config/database.js'
import UserStock from '../models/userStocks.js'

function mapRowToUserStock (row: any): UserStock {
  return {
    id: row.id,
    uid: row.uid,
    symbol: row.symbol,
    quantity: row.quantity,
    purchasePrice: row.purchase_price ?? null,
    purchaseDate: row.purchase_date ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

let isUserStocksTableInitialized = false

async function ensureUserStocksTable () {
  if (isUserStocksTableInitialized) return

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`

  await sql`
    CREATE TABLE IF NOT EXISTS user_stocks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uid TEXT NOT NULL REFERENCES user_profiles(uid) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity >= 0),
      purchase_price NUMERIC(10, 2),
      purchase_date DATE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS user_stocks_uid_symbol_uniq
    ON user_stocks(uid, symbol)
  `

  isUserStocksTableInitialized = true
}

export async function getUserStocks (req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user?.uid) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  await ensureUserStocksTable()

  try {
    const rows = await sql`
      SELECT *
      FROM user_stocks
      WHERE uid = ${req.user.uid}
      ORDER BY created_at DESC
    `

    res.json({ stocks: rows.map(mapRowToUserStock) })
  } catch (error) {
    console.error('Error fetching user stocks:', error)
    res.status(500).json({ error: 'Failed to fetch user stocks' })
  }
}

export async function createUserStock (req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user?.uid) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  await ensureUserStocksTable()

  const body = req.body as {
    symbol?: string
    quantity?: number
    purchasePrice?: number | null
    purchaseDate?: string | null
  }

  const symbol = body?.symbol?.trim()?.toUpperCase()
  const quantity = body?.quantity
  const purchasePrice = body?.purchasePrice ?? null
  const purchaseDate = body?.purchaseDate ?? null

  if (!symbol) {
    res.status(400).json({ error: 'symbol is required' })
    return
  }

  if (quantity === undefined || quantity === null || Number.isNaN(Number(quantity))) {
    res.status(400).json({ error: 'quantity is required' })
    return
  }

  const safeQuantity = Number(quantity)
  if (!Number.isFinite(safeQuantity) || safeQuantity < 0) {
    res.status(400).json({ error: 'quantity must be a number over 1' })
    return
  }

  try {
    const rows = await sql`
      INSERT INTO user_stocks (uid, symbol, quantity, purchase_price, purchase_date)
      VALUES (${req.user.uid}, ${symbol}, ${safeQuantity}, ${purchasePrice}, ${purchaseDate})
      ON CONFLICT (uid, symbol) DO UPDATE
      SET quantity = EXCLUDED.quantity,
          purchase_price = EXCLUDED.purchase_price,
          purchase_date = EXCLUDED.purchase_date,
          updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `

    res.status(201).json({ stock: mapRowToUserStock(rows[0]) })
  } catch (error) {
    console.error('Error creating user stock:', error)
    res.status(500).json({ error: 'Failed to create user stock' })
  }
}

export async function deleteUserStock (req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user?.uid) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  await ensureUserStocksTable()

  const id = req.params.id
  if (!id) {
    res.status(400).json({ error: 'id is required' })
    return
  }

  try {
    const result = await sql`
      DELETE FROM user_stocks
      WHERE id = ${id} AND uid = ${req.user.uid}
    `

    if (result.count === 0) {
      res.status(404).json({ error: 'Stock not found' })
      return
    }

    res.status(204).send()
  } catch (error) {
    console.error('Error deleting user stock:', error)
    res.status(500).json({ error: 'Failed to delete user stock' })
  }
}
