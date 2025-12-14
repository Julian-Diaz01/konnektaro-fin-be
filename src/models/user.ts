interface UserProfile {
    uid: string
    email?: string | null
    displayName?: string | null
    createdAt: Date
    updatedAt: Date
  }

export type { UserProfile }