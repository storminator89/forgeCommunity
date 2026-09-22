import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { Prisma } from '@prisma/client';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcrypt';

import prisma from '@/lib/prisma';
import {
  normalizeEmail,
  utf8ByteLength,
} from '@/lib/server/auth-security';

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
      const rawEmail = credentials?.email;
      const password = credentials?.password;
      const email = typeof rawEmail === 'string' ? normalizeEmail(rawEmail) : '';

      if (!email || typeof password !== 'string' || !password) {
        return null;
      }

      // bcrypt only uses the first 72 UTF-8 bytes. Rejecting longer input
      // avoids silently authenticating a password whose suffix was ignored.
      if (utf8ByteLength(password) > 72) {
        return null;
      }

      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: {
          id: true,
          email: true,
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

      return { id: user.id, email: user.email };
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
    async jwt({ token, user }) {
      // `session` data on an update is client supplied. Never merge it into
      // the token: identity and authorization claims must come from Prisma.
      const userId =
        (typeof user?.id === 'string' && user.id) ||
        (typeof token.id === 'string' && token.id) ||
        (typeof token.sub === 'string' && token.sub);

      if (!userId) return token;

      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: userSelect,
      });

      // A signed JWT can outlive its database row. Returning an empty token
      // makes session/middleware checks reject it on the next request.
      if (!currentUser) return {} as typeof token;

      const userForToken = user
        ? await prisma.user.update({
            where: { id: currentUser.id },
            data: { lastLogin: new Date() },
            select: userSelect,
          })
        : currentUser;

      return {
        ...token,
        ...mapUserToToken(userForToken),
        sub: userForToken.id,
      };
    },

    async session({ session, token }) {
      if (typeof token.id !== 'string' || token.id.length === 0) {
        return null as unknown as typeof session;
      }

      if (!session.user) return session;

      // Copy only claims written by the server-side jwt callback. In
      // particular, no properties from a client supplied session update are
      // trusted here.
      session.user = {
        id: token.id,
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
