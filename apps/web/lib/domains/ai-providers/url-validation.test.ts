import { describe, expect, it } from "vitest";

import {
  describeConnectionFailure,
  isDockerInternalHostname,
  validateProviderBaseUrl,
} from "./url-validation";

describe("isDockerInternalHostname", () => {
  it("detecta nombre de servicio Docker tipo proyecto_servicio", () => {
    expect(isDockerInternalHostname("azoramind_ollama")).toBe(true);
  });

  it("detecta nombre simple sin TLD", () => {
    expect(isDockerInternalHostname("ollama")).toBe(true);
    expect(isDockerInternalHostname("postgres")).toBe(true);
  });

  it("detecta nombre con guiones (compose default)", () => {
    expect(isDockerInternalHostname("my-service")).toBe(true);
  });

  it("NO marca localhost como Docker-internal", () => {
    expect(isDockerInternalHostname("localhost")).toBe(false);
  });

  it("NO marca IP literal como Docker-internal", () => {
    expect(isDockerInternalHostname("127.0.0.1")).toBe(false);
    expect(isDockerInternalHostname("10.0.0.5")).toBe(false);
    expect(isDockerInternalHostname("192.168.1.100")).toBe(false);
  });

  it("NO marca FQDN como Docker-internal", () => {
    expect(isDockerInternalHostname("azoramind-ollama.l7weu8.easypanel.host")).toBe(false);
    expect(isDockerInternalHostname("api.anthropic.com")).toBe(false);
    expect(isDockerInternalHostname("example.com")).toBe(false);
  });

  it("NO marca string vacio", () => {
    expect(isDockerInternalHostname("")).toBe(false);
  });

  it("NO marca IPv6 entre corchetes", () => {
    expect(isDockerInternalHostname("[::1]")).toBe(false);
  });

  it("NO marca nombres con caracteres invalidos para Docker", () => {
    // Docker no permite mayusculas con underscore mezclado, espacios, etc.
    expect(isDockerInternalHostname("Service Name")).toBe(false);
  });
});

describe("validateProviderBaseUrl", () => {
  it("acepta URL publica https con FQDN", () => {
    const r = validateProviderBaseUrl("https://api.openai.com");
    expect(r.valid).toBe(true);
    expect(r.isDockerInternal).toBe(false);
    expect(r.warning).toBeUndefined();
  });

  it("acepta URL EasyPanel publica (caso documentado)", () => {
    const r = validateProviderBaseUrl("https://azoramind-ollama.l7weu8.easypanel.host/");
    expect(r.valid).toBe(true);
    expect(r.isDockerInternal).toBe(false);
  });

  it("acepta localhost para desarrollo", () => {
    const r = validateProviderBaseUrl("http://localhost:11434");
    expect(r.valid).toBe(true);
    expect(r.isDockerInternal).toBe(false);
  });

  it("acepta IP literal con puerto (deployment self-hosted)", () => {
    const r = validateProviderBaseUrl("http://46.224.250.197:11434");
    expect(r.valid).toBe(true);
    expect(r.isDockerInternal).toBe(false);
  });

  it("marca como valid pero con warning si hostname es Docker-internal", () => {
    // El caso real que rompio prod 2026-05-31
    const r = validateProviderBaseUrl("http://azoramind_ollama:11434/");
    expect(r.valid).toBe(true);
    expect(r.isDockerInternal).toBe(true);
    expect(r.warning).toContain("azoramind_ollama");
    expect(r.warning).toContain("Docker");
    expect(r.suggestion).toContain("easypanel.host");
  });

  it("rechaza URL no parseable", () => {
    const r = validateProviderBaseUrl("not a url");
    expect(r.valid).toBe(false);
  });

  it("rechaza protocolo no http/https", () => {
    const r = validateProviderBaseUrl("ftp://server/path");
    expect(r.valid).toBe(false);
    expect(r.warning).toContain("Protocolo");
  });

  it("rechaza null/undefined/empty", () => {
    expect(validateProviderBaseUrl(null).valid).toBe(false);
    expect(validateProviderBaseUrl(undefined).valid).toBe(false);
    expect(validateProviderBaseUrl("").valid).toBe(false);
    expect(validateProviderBaseUrl("   ").valid).toBe(false);
  });
});

describe("describeConnectionFailure", () => {
  it("agrega hint Docker cuando baseUrl es internal", () => {
    const msg = describeConnectionFailure(
      "http://azoramind_ollama:11434/",
      "Ollama conexion fallida: timeout despues de 25s",
    );
    expect(msg).toContain("timeout");
    expect(msg).toContain("Docker");
    expect(msg).toContain("easypanel.host");
  });

  it("NO agrega hint Docker cuando baseUrl es publica", () => {
    const msg = describeConnectionFailure(
      "https://api.openai.com",
      "OpenAI HTTP 500",
    );
    expect(msg).toBe("OpenAI HTTP 500");
    expect(msg).not.toContain("Docker");
  });

  it("maneja baseUrl no parseable sin crashear", () => {
    const msg = describeConnectionFailure("not a url", "boom");
    // Sin Docker hint y sin throw
    expect(msg).toBe("boom");
  });
});
