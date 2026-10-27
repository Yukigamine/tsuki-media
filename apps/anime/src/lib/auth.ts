import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { getProductionBaseUrl, getServerBaseUrl } from "@/lib/base-url";
import prisma from "@/lib/prisma";

const AUTHORIZED_EMAIL = process.env.AUTHORIZED_EMAIL;
const APP_URL = getServerBaseUrl();
const PRODUCTION_URL = getProductionBaseUrl();

const customOAuthPlugin =
  process.env.CUSTOM_OAUTH_CLIENT_ID && process.env.CUSTOM_OAUTH_CLIENT_SECRET
    ? genericOAuth({
        config: (
          [
            process.env.CUSTOM_OAUTH_AUTHORIZATION_URL &&
            process.env.CUSTOM_OAUTH_TOKEN_URL &&
            process.env.CUSTOM_OAUTH_USERINFO_URL
              ? {
                  providerId: "oauth",
                  clientId: process.env.CUSTOM_OAUTH_CLIENT_ID,
                  clientSecret: process.env.CUSTOM_OAUTH_CLIENT_SECRET,
                  authorizationUrl: process.env.CUSTOM_OAUTH_AUTHORIZATION_URL,
                  tokenUrl: process.env.CUSTOM_OAUTH_TOKEN_URL,
                  userInfoUrl: process.env.CUSTOM_OAUTH_USERINFO_URL,
                  scopes: ["openid", "email", "profile"],
                }
              : process.env.CUSTOM_OAUTH_DISCOVERY_URL
                ? {
                    providerId: "oauth",
                    clientId: process.env.CUSTOM_OAUTH_CLIENT_ID,
                    clientSecret: process.env.CUSTOM_OAUTH_CLIENT_SECRET,
                    discoveryUrl: process.env.CUSTOM_OAUTH_DISCOVERY_URL,
                    scopes: ["openid", "email", "profile"],
                  }
                : null,
          ] as const
        ).filter((x) => x !== null),
      })
    : null;

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: APP_URL,
  trustedOrigins: [
    APP_URL,
    PRODUCTION_URL,
    "http://localhost:3000",
    "https://tsuki-client-*-team-yuki.vercel.app",
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []),
  ],

  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET
      ? {
          discord: {
            clientId: process.env.DISCORD_CLIENT_ID,
            clientSecret: process.env.DISCORD_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET
      ? {
          twitter: {
            clientId: process.env.TWITTER_CLIENT_ID,
            clientSecret: process.env.TWITTER_CLIENT_SECRET,
          },
        }
      : {}),
  },

  plugins: [
    ...(customOAuthPlugin ? [customOAuthPlugin] : []),
    oAuthProxy({
      productionURL: PRODUCTION_URL,
      secret: process.env.BETTER_AUTH_OAUTH_PROXY_SECRET?.trim() || undefined,
    }),
  ],

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const existingUser = await prisma.user.findFirst({
            select: { id: true, email: true },
          });

          if (
            existingUser &&
            existingUser.email.toLowerCase() !== user.email.toLowerCase()
          ) {
            throw new Error(
              "Access denied: this app instance only allows a single user identity.",
            );
          }

          if (
            AUTHORIZED_EMAIL &&
            user.email.toLowerCase() !== AUTHORIZED_EMAIL.toLowerCase()
          ) {
            throw new Error(
              `Access denied: ${user.email} is not authorized to use this app.`,
            );
          }
          return { data: user };
        },
      },
    },
  },
});
