import type { Response } from 'express'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import sql from '../config/database.js'
import { UserProfile } from '../models/user.js'


function mapRowToUserProfile (row: any): UserProfile {
  return {
    uid: row.uid,
    email: row.email,
    displayName: row?.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

let isUserTableInitialized = false

async function ensureUserProfilesTable () {
  if (isUserTableInitialized) return

  await sql`
    CREATE TABLE IF NOT EXISTS user_profiles (
      uid TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `

  isUserTableInitialized = true
}

export async function getCurrentUser (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  if (!req.user?.uid) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  await ensureUserProfilesTable()

  try {
    const rows = await sql`
      SELECT *
      FROM user_profiles
      WHERE uid = ${req.user.uid}
    `

    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json(mapRowToUserProfile(rows[0]))
  } catch (error) {
    console.error('Error fetching user profile:', error)
    res.status(500).json({ error: 'Failed to fetch user profile' })
  }
}

export async function createUser (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  if (!req.user?.uid) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  await ensureUserProfilesTable()

  // All data comes from Firebase token
  const email = req.user.email ?? null
  const displayName = req.user.displayName ?? null

  if (!email) {
    res.status(400).json({ error: 'Email is required in Firebase token' })
    return
  }

  try {
    const rows = await sql<UserProfile[]>`
      INSERT INTO user_profiles (uid, email, display_name)
      VALUES (${req.user.uid}, ${email}, ${displayName})
      ON CONFLICT (uid) DO UPDATE
      SET email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `

    res.status(201).json({ user: mapRowToUserProfile(rows[0]) })
  } catch (error) {
    console.error('Error creating user profile:', error)
    res.status(500).json({ error: 'Failed to create user profile' })
  }
}

export async function updateUser (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  if (!req.user?.uid) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  await ensureUserProfilesTable()

  const { name, email } = req.body as { name?: string, email?: string }
  const safeEmail = email ?? null
  const safeName = name ?? null

  if (!name && !email) {
    res.status(400).json({ error: 'No fields to update' })
    return
  }

  try {
    const rows = await sql`
      UPDATE user_profiles
      SET
        email = COALESCE(${safeEmail}, email),
        display_name = COALESCE(${safeName}, display_name),
        updated_at = CURRENT_TIMESTAMP
      WHERE uid = ${req.user.uid}
      RETURNING *
    ` as UserProfile[]

    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({ user: mapRowToUserProfile(rows[0]) })
  } catch (error) {
    console.error('Error updating user profile:', error)
    res.status(500).json({ error: 'Failed to update user profile' })
  }
}

export async function deleteUser (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  if (!req.user?.uid) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  await ensureUserProfilesTable()

  try {
    const result = await sql`
      DELETE FROM user_profiles
      WHERE uid = ${req.user.uid}
    `

    if (result.count === 0) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.status(204).send()
  } catch (error) {
    console.error('Error deleting user profile:', error)
    res.status(500).json({ error: 'Failed to delete user profile' })
  }
}


