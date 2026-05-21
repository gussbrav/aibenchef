/**
 * Cliente Better Auth para usar desde React components (browser).
 *
 * baseURL = window.location.origin (no NEXT_PUBLIC_APP_URL hardcoded).
 *
 * NEXT_PUBLIC_APP_URL se inyecta en build-time, asi que si el usuario
 * accede por un dominio distinto (easypanel.host, staging, preview deploy)
 * la request va al dominio del build -> CORS bloquea -> form se cuelga.
 * Usar el origin actual asegura same-origin POST en todos los casos.
 *
 * Importar y usar:
 *   import { authClient } from "@/lib/auth/client";
 *   await authClient.signIn.email({ email, password });
 */
import { createAuthClient } from "better-auth/react";

const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

export const authClient = createAuthClient({ baseURL });

export const { signIn, signUp, signOut, useSession } = authClient;
