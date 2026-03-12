import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { Prisma } from '@prisma/client';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcrypt';

import prisma from '@/lib/prisma';

const userSelect = {
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
  userSettings: true,
} as const;

type SelectedUser = Prisma.UserGetPayload<{
  select: typeof userSelect;
}>;

function mapUserToToken(user: NonNullable<SelectedUser>) {
  return {
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
    settings: user.userSettings,
  };
}

const providers: NextAuthOptions['providers'] = [
  CredentialsProvider({
    name: 'Credentials',
    credentials: {
      email: { label: 'Email', type: 'text' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      const email = credentials?.email?.trim().toLowerCase();
      const password = credentials?.password;

      if (!email || !password) {
        return null;
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          password: true,
        },
      });

      if (!user?.password) {
        return null;
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return null;
      }

      return { id: user.id, email };
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.unshift(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers,
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (trigger === 'update' && session?.user) {
        return {
          ...token,
          ...session.user,
        };
      }

      if (user?.id) {
        const currentUser = await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
          select: userSelect,
        });

        return {
          ...token,
          ...mapUserToToken(currentUser),
        };
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user = {
          ...session.user,
          id: token.id as string,
          role: token.role as string | null,
          email: token.email as string | null,
          name: token.name as string | null,
          image: token.image as string | null,
          title: token.title as string | null,
          bio: token.bio as string | null,
          contact: token.contact as string | null,
          endorsements: token.endorsements as number | undefined,
          emailVerified: token.emailVerified as Date | null | undefined,
          lastLogin: token.lastLogin as Date | null | undefined,
          settings: (token.settings as typeof session.user.settings) ?? null,
        };
      }

      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/auth/error',
    signOut: '/auth/signout',
    verifyRequest: '/auth/verify-request',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  jwt: {
    maxAge: 30 * 24 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development',
};
