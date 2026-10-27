import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { username } from "better-auth/plugins/username";
import { getServerBaseUrl } from "@/lib/base-url";
import prisma from "@/lib/prisma";

const APP_URL = getServerBaseUrl();

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
  emailAndPassword: { enabled: true },

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

  plugins: [username(), ...(customOAuthPlugin ? [customOAuthPlugin] : [])],

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const existingUser = await prisma.user.findFirst({
            select: { id: true },
          });
          const settings = await prisma.settings.findUnique({
            where: { id: "app" },
            select: { masterEmail: true },
          });
          const authorizedEmail =
            settings?.masterEmail || process.env.AUTHORIZED_EMAIL;

          if (existingUser) {
            throw new Error(
              "Access denied: this app instance only allows a single user identity.",
            );
          }

          if (
            authorizedEmail &&
            user.email.toLowerCase() !== authorizedEmail.toLowerCase()
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
