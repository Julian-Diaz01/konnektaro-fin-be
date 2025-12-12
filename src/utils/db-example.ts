/**
 * Example usage of database utilities
 * This file demonstrates how to use the database connection in your routes
 */

import { query, getClient } from './db.js'

// Example 1: Simple query
export async function exampleSimpleQuery () {
  const result = await query('SELECT * FROM users WHERE id = $1', [1])
  return result.rows
}

// Example 2: Insert with parameters
export async function exampleInsert (name: string, email: string) {
  const result = await query(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
    [name, email]
  )
  return result.rows[0]
}

// Example 4: Typed query result
interface User {
  id: number
  name: string
  email: string
  created_at: Date
}

export async function exampleTypedQuery (): Promise<User[]> {
  const result = await query<User>('SELECT * FROM users')
  return result.rows
}

