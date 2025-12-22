import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import prisma from "@/lib/prisma"
import bcrypt from "bcrypt"

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Bitte E-Mail und Passwort eingeben')
        }

        try {
          // 1. Benutzer finden
          const user = await prisma.user.findUnique({
            where: { email: credentials.email },
            include: { userSettings: true }
          })

          if (!user || !user.password) {
            throw new Error('Benutzer nicht gefunden')
          }

          // 2. Passwort überprüfen
          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          )

          if (!isPasswordValid) {
            throw new Error('Ungültiges Passwort')
          }

          // 3. lastLogin in separater Operation aktualisieren
          const loginUpdate = await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              image: true,
              title: true,
              bio: true,
              contact: true,
              endorsements: true,
              emailVerified: true,
              lastLogin: true,
              createdAt: true,
              updatedAt: true
            }
          })

          console.log('Login update completed:', {
            userId: loginUpdate.id,
            email: loginUpdate.email,
            lastLogin: loginUpdate.lastLogin
          })

          // 4. Benutzer mit allen aktuellen Daten zurückgeben
          return {
            ...loginUpdate,
            settings: user.userSettings
          }
        } catch (error) {
          console.error('Error in authorize:', error)
          throw error
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (trigger === "update" && session) {
        return { ...token, ...session.user }
      }

      if (user) {
        // Alle Benutzerdaten in das Token kopieren
        token = {
          ...token,
          id: user.id,
          role: user.role,
          email: user.email,
          name: user.name,
          image: user.image,
          title: user.title,
          bio: user.bio,
          contact: user.contact,
          endorsements: user.endorsements,
          emailVerified: user.emailVerified,
          lastLogin: user.lastLogin,
          settings: user.settings
        }

        console.log('JWT updated with user data:', {
          userId: user.id,
          email: user.email,
          lastLogin: user.lastLogin
        })
      }
      return token
    },

    async session({ session, token }) {
      if (session?.user) {
        // Token-Daten in die Session kopieren
        session.user = {
          ...session.user,
          id: token.id as string,
          role: token.role as string,
          email: token.email as string,
          name: token.name as string,
          image: token.image as string | null,
          title: token.title as string | null,
          bio: token.bio as string | null,
          contact: token.contact as string | null,
          endorsements: token.endorsements as number,
          emailVerified: token.emailVerified as Date | null,
          lastLogin: token.lastLogin as Date | null,
          settings: token.settings as any
        }

        // Aktuelle Daten aus der Datenbank holen
        const currentUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: {
            lastLogin: true,
            userSettings: true,
            endorsements: true
          }
        })

        if (currentUser) {
          console.log('Current user data fetched:', {
            userId: token.id,
            lastLogin: currentUser.lastLogin
          })

          session.user.lastLogin = currentUser.lastLogin
          session.user.settings = currentUser.userSettings as any
          session.user.endorsements = currentUser.endorsements
        }
      }
      return session
    }
  },

  events: {
    async signIn({ user }) {
      try {
        const result = await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
          select: {
            id: true,
            email: true,
            lastLogin: true
          }
        })

        console.log('SignIn event completed:', {
          userId: result.id,
          email: result.email,
          lastLogin: result.lastLogin
        })
      } catch (error) {
        console.error('Error in signIn event:', error)
      }
    }
  },

  pages: {
    signIn: '/login',
    error: '/auth/error',
    signOut: '/auth/signout',
    verifyRequest: '/auth/verify-request',
  },

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 Tage
    updateAge: 24 * 60 * 60, // 24 Stunden
  },

  jwt: {
    maxAge: 30 * 24 * 60 * 60, // 30 Tage
  },

  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development'
}
