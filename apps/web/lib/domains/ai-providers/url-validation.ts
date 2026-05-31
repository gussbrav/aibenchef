/**
 * Validacion de Base URLs para proveedores de IA.
 *
 * El caso problematico (descubierto en prod 2026-05-31): un proveedor se
 * configura con un hostname interno de Docker como `azoramind_ollama`. Si
 * el servicio que consume vive en OTRO proyecto EasyPanel, el DNS interno
 * no resuelve → timeout despues de 25s sin pista clara para el usuario.
 *
 * Este modulo centraliza la deteccion + sugerencia. Lo usan:
 * - lib/domains/genie/providers/ollama.ts (mensaje de error en runtime)
 * - app/api/v1/settings/ai-providers/[provider]/route.ts (warning al guardar)
 * - app/api/v1/settings/ai-providers/[provider]/test/route.ts (hint en /test)
 */

export type BaseUrlValidation = {
  /** Si la URL es estructuralmente valida (parseable como URL). */
  valid: boolean;
  /** True si el hostname parece nombre de servicio Docker (sin TLD ni IP). */
  isDockerInternal: boolean;
  /** Mensaje opcional para mostrar al usuario al guardar / loguear. */
  warning?: string;
  /** Si aplica, sugerencia textual de como corregir. */
  suggestion?: string;
};

/**
 * Detecta si el hostname de una URL parece un nombre de servicio Docker
 * interno (ej. `azoramind_ollama`, `postgres`, `ollama_service`).
 *
 * Criterio: hostname formado solo por letras/digitos/`_`/`-`, sin punto y
 * sin ser una IP literal. Estos hostnames solo resuelven dentro de la
 * misma red Docker (mismo proyecto en EasyPanel/Compose).
 *
 * Hostnames que son `localhost` o `127.0.0.1` NO se consideran Docker-internal
 * — son legitimos para desarrollo local.
 */
export function isDockerInternalHostname(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === "localhost") return false;
  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  // IPv6 literal (entre corchetes en URL)
  if (h.startsWith("[") && h.endsWith("]")) return false;
  // Si tiene punto, es FQDN o subdomain — no es Docker-internal
  if (h.includes(".")) return false;
  // Solo a-z, 0-9, _, - → patron tipico de service name de Docker
  return /^[a-z0-9][a-z0-9_-]*$/.test(h);
}

/**
 * Valida una baseUrl para un provider y devuelve diagnostico estructurado.
 *
 * No throwa — devuelve `valid: false` cuando la URL es inservible. El caller
 * decide si bloquear o solo loguear/avisar.
 */
export function validateProviderBaseUrl(
  rawUrl: string | null | undefined,
): BaseUrlValidation {
  if (!rawUrl || !rawUrl.trim()) {
    return { valid: false, isDockerInternal: false };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      valid: false,
      isDockerInternal: false,
      warning: "La URL no es valida. Debe arrancar con http:// o https://.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      isDockerInternal: false,
      warning: `Protocolo no soportado: ${parsed.protocol}. Usa http:// o https://.`,
    };
  }

  const docker = isDockerInternalHostname(parsed.hostname);
  if (!docker) {
    return { valid: true, isDockerInternal: false };
  }

  return {
    valid: true,
    isDockerInternal: true,
    warning:
      `El hostname "${parsed.hostname}" parece un nombre de servicio Docker interno. ` +
      "Solo va a resolver si el contenedor web esta en la MISMA red Docker " +
      "(mismo proyecto EasyPanel). Si esta en otro proyecto, usa el dominio publico.",
    suggestion:
      "Ejemplo: si el servicio en EasyPanel tiene dominio publico " +
      "https://<service>.<random>.easypanel.host, usa ese en vez del nombre interno.",
  };
}

/**
 * Cuando ocurre un timeout/DNS fail en runtime, esto formatea el hint
 * concreto para el mensaje de error. Centraliza el texto que antes vivia
 * en ollama.ts.
 */
export function describeConnectionFailure(
  baseUrl: string,
  underlyingMessage: string,
): string {
  let hostname = "";
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    // ignore
  }
  const docker = hostname ? isDockerInternalHostname(hostname) : false;
  const hint = docker
    ? " (el hostname parece nombre de servicio Docker — verifica que el contenedor " +
      "web este en la misma red, o setea la baseUrl con un dominio publico tipo " +
      "https://<servicio>.easypanel.host)"
    : "";
  return `${underlyingMessage}${hint}`;
}
