import NextAuth from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role?: string | null
      title?: string | null
      bio?: string | null
      contact?: string | null
      endorsements?: number
      emailVerified?: Date | null
      lastLogin?: Date | null
      settings?: {
        id: string
        userId: string
        emailNotifications: boolean
        pushNotifications: boolean
        theme: 'LIGHT' | 'DARK'
        language: string
      } | null
    }
  }

  interface User {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
    password?: string | null
    role?: string | null
    title?: string | null
    bio?: string | null
    contact?: string | null
    endorsements?: number
    emailVerified?: Date | null
    lastLogin?: Date | null
    verificationToken?: string | null
    resetPasswordToken?: string | null
    createdAt?: Date
    updatedAt?: Date
    settings?: {
      id: string
      userId: string
      emailNotifications: boolean
      pushNotifications: boolean
      theme: 'LIGHT' | 'DARK'
      language: string
    } | null
  }

  interface JWT {
    id: string
    role?: string | null
    email?: string | null
    name?: string | null
    image?: string | null
    title?: string | null
    bio?: string | null
    contact?: string | null
    endorsements?: number
    emailVerified?: Date | null
    lastLogin?: Date | null
    settings?: {
      id: string
      userId: string
      emailNotifications: boolean
      pushNotifications: boolean
      theme: 'LIGHT' | 'DARK'
      language: string
    } | null
  }
}
