/**
 * Cliente Better Auth para usar desde React components (browser).
 *
 * Importar y usar:
 *   import { authClient } from "@/lib/auth/client";
 *   await authClient.signIn.email({ email, password });
 */
import { createAuthClient } from "better-auth/react";

const baseURL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

export const authClient = createAuthClient({ baseURL });

export const { signIn, signUp, signOut, useSession } = authClient;
