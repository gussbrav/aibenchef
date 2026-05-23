// Barrel publico del dominio informe.
//
// IMPORTANTE: Solo re-exporta types y constantes (cliente-safe).
// Las queries (que usan db.execute, sql tags, etc) hay que importarlas
// directamente desde "./queries" — solo desde server components o route
// handlers, no desde "use client" files.
//
// Esto previene que el bundler arrastre drizzle-orm + postgres al
// client bundle por transitividad cuando un client component hace
// import type { EntidadDisponible } from "@/lib/domains/informe".

export * from "./types";
