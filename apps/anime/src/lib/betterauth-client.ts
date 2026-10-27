import { InferServerPlugin, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "@/lib/auth";
import { getClientBaseUrl } from "@/lib/base-url";

export const authClient = createAuthClient({
  baseURL: getClientBaseUrl(),
  plugins: [InferServerPlugin<typeof auth, "generic-oauth">(), usernameClient()],
});
