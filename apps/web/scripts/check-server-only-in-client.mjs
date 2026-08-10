#!/usr/bin/env node
/**
 * check-server-only-in-client.mjs
 *
 * REGRESION del bug de deploy en EasyPanel (commit 2ae6082):
 * el client component publicaciones/client.tsx importaba PUBLICACION_TEMAS_META
 * desde el barrel @/lib/domains/publicaciones, y el barrel re-exportaba
 * service.ts que tiene `import "server-only"`. Next.js detecta la fuga
 * al analizar el arbol de dependencias — build fail correcto pero ya
 * en produccion.
 *
 * Este script atrapa el bug en local ANTES del deploy. Estrategia:
 *
 * 1. Encuentra todos los archivos client (`"use client"` en la primera
 *    linea significativa) bajo apps/web/app y apps/web/components.
 * 2. Para cada import de `@/lib/domains/*` (barrel — path sin sub-modulo),
 *    resuelve el barrel `index.ts` correspondiente.
 * 3. Lee el barrel y verifica si re-exporta algun archivo con `"server-only"`.
 * 4. Si hay match, error con path + linea del import problematico.
 *
 * Uso:
 *   node scripts/check-server-only-in-client.mjs
 *
 * Integrable en package.json como "check:client-imports" o en el pre-push.
 * Salida: exit 0 si limpio, exit 1 si hay violaciones.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";

// __dirname en ESM
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

const REPO_WEB = resolve(__dirname, "..");  // apps/web/
const LIB_DOMAINS = resolve(REPO_WEB, "lib", "domains");
const SEARCH_ROOTS = [
  resolve(REPO_WEB, "app"),
  resolve(REPO_WEB, "components"),
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Recorre recursivamente un directorio y devuelve archivos .ts/.tsx. */
function* walkTsFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walkTsFiles(full);
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield full;
    }
  }
}

/** True si el archivo tiene "use client" en las primeras N lineas significativas. */
function isClientFile(path) {
  const content = readFileSync(path, "utf8");
  // Buscamos "use client" en las primeras 5 lineas (post-comments/blancos).
  const lines = content.split("\n").slice(0, 15);
  for (const line of lines) {
    const t = line.trim();
    if (t === "") continue;
    if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) continue;
    if (t === '"use client";' || t === "'use client';") return true;
    // Si la primera linea real no es "use client", no es client component.
    return false;
  }
  return false;
}

/**
 * Extrae los imports que apuntan a barrels de @/lib/domains/*
 * (sin sub-path — ej. "@/lib/domains/publicaciones" sí, pero
 * "@/lib/domains/publicaciones/types" no).
 *
 * Retorna [{path, line, module}].
 */
function extractDomainBarrelImports(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const out = [];
  const importRegex = /^\s*import\s+(?:type\s+)?[^"']+from\s+["']([^"']+)["'];?/;
  const barrelRegex = /^@\/lib\/domains\/([^/]+)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(importRegex);
    if (!m) continue;
    const mod = m[1];
    const bm = mod.match(barrelRegex);
    if (bm) {
      // Skipear si es import type only (Next.js elimina types del bundle
      // client asi que no hay fuga real). Detectamos "import type" al inicio.
      const isTypeOnly = /^\s*import\s+type\s+/.test(lines[i]);
      if (!isTypeOnly) {
        out.push({ path: filePath, line: i + 1, module: mod, domain: bm[1] });
      }
    }
  }
  return out;
}

/**
 * Lee el barrel index.ts de un dominio y devuelve la lista de sub-modulos
 * que re-exporta ("./service", "./meta", etc → paths absolutos).
 */
function getBarrelReExports(domain) {
  const barrelPath = join(LIB_DOMAINS, domain, "index.ts");
  if (!existsSync(barrelPath)) return { exists: false, exports: [] };
  const content = readFileSync(barrelPath, "utf8");
  const lines = content.split("\n");
  const out = [];
  const exportRegex = /^\s*export\s+(?:\*|{[^}]*})\s+from\s+["'](\.\/[^"']+)["'];?/;
  for (const line of lines) {
    const m = line.match(exportRegex);
    if (m) {
      const relPath = m[1];
      // Resolver .ts (probamos varias extensiones)
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        const full = join(LIB_DOMAINS, domain, relPath + ext);
        if (existsSync(full)) {
          out.push(full);
          break;
        }
      }
    }
  }
  return { exists: true, exports: out };
}

/** True si el archivo tiene `import "server-only"` cerca del top. */
function hasServerOnlyImport(path) {
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  return /^\s*import\s+["']server-only["'];?/m.test(content);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

let violations = 0;
let clientFilesScanned = 0;

for (const root of SEARCH_ROOTS) {
  for (const file of walkTsFiles(root)) {
    if (!isClientFile(file)) continue;
    clientFilesScanned++;
    const imports = extractDomainBarrelImports(file);
    for (const imp of imports) {
      const { exists, exports: reExports } = getBarrelReExports(imp.domain);
      if (!exists) continue;
      const serverOnlyModules = reExports.filter(hasServerOnlyImport);
      if (serverOnlyModules.length > 0) {
        violations++;
        const relFile = relative(REPO_WEB, imp.path).replace(/\\/g, "/");
        console.error(
          `\x1b[31m[server-only-leak]\x1b[0m ${relFile}:${imp.line}`,
        );
        console.error(
          `  Client component importa desde barrel "@/lib/domains/${imp.domain}"`,
        );
        console.error(
          `  que re-exporta modulo(s) con \`import "server-only"\`:`,
        );
        for (const m of serverOnlyModules) {
          console.error(`    - ${relative(REPO_WEB, m).replace(/\\/g, "/")}`);
        }
        console.error(
          `  Fix: importar desde el sub-modulo especifico (ej. "@/lib/domains/${imp.domain}/types" o /meta)\n`,
        );
      }
    }
  }
}

console.log(
  `[server-only-leak] Escaneados ${clientFilesScanned} client files. Violaciones: ${violations}`,
);
process.exit(violations > 0 ? 1 : 0);
