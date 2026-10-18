import { NextAuthOptions } from 'next-auth';
import type { AdapterAccount } from 'next-auth/adapters';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { Prisma } from '@prisma/client';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import { passwordFingerprint, samePasswordFingerprint } from '@/lib/server/account-security';
import { safeLoginCallback } from '@/lib/auth-login';
import { createOAuthProviders, verifiedOAuthEmail } from '@/lib/server/oauth-providers';

import prisma from '@/lib/prisma';
import { emailEqualsInsensitive } from '@/lib/server/database-query';
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
  password: true,
} as const;

type SelectedUser = Prisma.UserGetPayload<{
  select: typeof userSelect;
}>;

function mapUserToToken(user: NonNullable<SelectedUser>) {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name?.slice(0, 120) ?? null,
    image: user.image && user.image.length <= 2048 ? user.image : null,
    title: user.title?.slice(0, 200) ?? null,
  };
}

const oauthConfiguration = createOAuthProviders();
const providers: NextAuthOptions['providers'] = [
  ...oauthConfiguration.providers,
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
        where: await emailEqualsInsensitive(email),
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

export const oauthIssuerFor = oauthConfiguration.issuerFor;
export async function authProvidersForRequest(provider: string): Promise<NextAuthOptions['providers']> {
  return [
    ...await oauthConfiguration.resolveProviders(provider),
    ...providers.filter(configured => configured.id === 'credentials'),
  ];
}

type SignInArguments = Parameters<NonNullable<NonNullable<NextAuthOptions['callbacks']>['signIn']>>[0];

export async function authorizeSignIn(
  { account, profile }: SignInArguments,
  currentSessionUserId: string | null = null,
): Promise<boolean | string> {
  if (account?.type === 'credentials' && account.provider === 'credentials' && !profile) return true;
  if (account?.type !== 'oauth' || !oauthConfiguration.enabledIds.some(id => id === account.provider)) return false;
  if (!oauthConfiguration.matchesIdentity(account.provider, account.providerAccountId, profile)) return false;

  const email = verifiedOAuthEmail(profile);
  if (!email) return '/login?error=OAuthEmailUnverified';

  try {
    const linkedAccount = await prisma.account.findUnique({
      where: { provider_providerAccountId: {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      } },
      select: { userId: true },
    });

    // NextAuth v4 otherwise links a new OAuth account to an existing signed-in
    // user, even with dangerous email linking disabled. Login is not a link flow.
    if (currentSessionUserId && linkedAccount?.userId !== currentSessionUserId) {
      return '/login?error=OAuthAccountNotLinked';
    }
    if (linkedAccount) return true;

    // Include legacy mixed-case addresses. The default Prisma adapter's
    // getUserByEmail lookup is case-sensitive on PostgreSQL.
    const existingUser = await prisma.user.findFirst({
      where: emailEqualsInsensitive(email),
      select: { id: true },
    });
    return existingUser ? '/login?error=OAuthAccountNotLinked' : true;
  } catch {
    // No database errors, claims or provider payloads in a browser redirect.
    console.error('[auth] OAUTH_SIGNIN_LOOKUP_FAILED');
    return '/login?error=OAuthCallback';
  }
}

const prismaAdapter = PrismaAdapter(prisma);
const identityOnlyAdapter: typeof prismaAdapter = {
  ...prismaAdapter,
  // Sign-in needs only the identity link, never stored provider credentials.
  linkAccount: ({ userId, type, provider, providerAccountId }: AdapterAccount) =>
    prismaAdapter.linkAccount!({ userId, type, provider, providerAccountId }),
};

export const authOptions: NextAuthOptions = {
  adapter: identityOnlyAdapter,
  providers,
  callbacks: {
    signIn: arguments_ => authorizeSignIn(arguments_),
    async redirect({ url, baseUrl }) {
      return `${new URL(baseUrl).origin}${safeLoginCallback(url, baseUrl)}`;
    },
    async jwt({ token, user, account }) {
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

      // Older tokens have no provider marker and cannot be distinguished from
      // credentials sessions created before this check. Require a fresh login.
      const provider = user
        ? (account?.provider === 'credentials' ? 'credentials' : 'oauth')
        : token.authProvider;
      if (provider !== 'credentials' && provider !== 'oauth') return {} as typeof token;

      const fingerprint = provider === 'credentials' && currentUser.password
        ? passwordFingerprint(currentUser.id, currentUser.password)
        : null;
      if (provider === 'credentials' &&
          (!fingerprint || (!user && !samePasswordFingerprint(token.passwordFingerprint, fingerprint)))) {
        return {} as typeof token;
      }

      const userForToken = user
        ? await prisma.user.update({
            where: { id: currentUser.id },
            data: { lastLogin: new Date() },
            select: userSelect,
          })
        : currentUser;

      return {
        // Do not carry legacy or client-supplied profile claims into the JWT.
        iat: token.iat,
        exp: token.exp,
        jti: token.jti,
        ...mapUserToToken(userForToken),
        sub: userForToken.id,
        authProvider: provider,
        passwordFingerprint: fingerprint,
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
    error: '/login',
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
  // OAuth debug metadata may contain tokens and personal claims.
  debug: false,
  logger: {
    error(code) { console.error('[auth]', /^[A-Z_]{1,80}$/.test(code) ? code : 'AUTH_ERROR'); },
    warn(code) { console.warn('[auth]', /^[A-Z_]{1,80}$/.test(code) ? code : 'AUTH_WARNING'); },
  },
};
