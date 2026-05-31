import type { LLMGenerationResult, LLMProvider } from "./types";

/**
 * Adapter para Ollama (self-hosted LLM server).
 *
 * Usa el endpoint /api/chat con format=json para forzar respuesta JSON valida.
 * Stream=false para tener la respuesta completa de una sola vez.
 *
 * Compatible con cualquier Ollama deployment — solo necesitamos baseUrl + model.
 *
 * Documentacion: https://github.com/ollama/ollama/blob/main/docs/api.md
 */
export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly modelo: string,
    private readonly apiKey?: string, // opcional, algunos deployments lo agregan via proxy
  ) {
    if (!baseUrl) throw new Error("Ollama: baseUrl requerida");
    if (!modelo) throw new Error("Ollama: modelo requerido");
  }

  async generateJson(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
  }): Promise<LLMGenerationResult> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/chat`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Algunos Ollama tienen un proxy con auth (cf-access, basic auth, etc).
    // Si hay apiKey, la mandamos como Authorization Bearer — la mayoria de
    // proxies aceptan ese formato.
    if (this.apiKey && this.apiKey.trim() && this.apiKey !== "ollama") {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.modelo,
      stream: false,
      format: "json", // fuerza JSON valido en la respuesta
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
      options: {
        num_predict: args.maxTokens,
        temperature: 0.1, // determinismo alto para SQL
      },
    };

    // Timeout corto a proposito: si Ollama no responde en 25s probablemente
    // el modelo es demasiado grande para el CPU del server o el hostname no
    // resuelve (Docker internal name). Mejor fallar rapido para que el
    // usuario vea el error y reaccione, que hacerle esperar 60s.
    const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 25_000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as { name?: string })?.name === "AbortError";
      const msg = aborted
        ? `timeout despues de ${TIMEOUT_MS / 1000}s`
        : e instanceof Error
          ? e.message
          : String(e);
      // Hint cuando el host parece Docker-internal (no resuelve desde otra red)
      const looksDocker = /^[a-z0-9][a-z0-9_-]*$/i.test(
        new URL(this.baseUrl).hostname,
      );
      const hint = looksDocker
        ? " (el hostname parece nombre de servicio Docker — verifica que el contenedor web este en la misma red, o setea OLLAMA_BASE_URL con una IP/dominio publico)"
        : "";
      throw new Error(`Ollama conexion fallida (${this.baseUrl}): ${msg}${hint}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Ollama HTTP ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const json = (await resp.json()) as {
      message?: { role: string; content: string };
      prompt_eval_count?: number;
      eval_count?: number;
      done_reason?: string;
    };

    if (!json.message?.content) {
      throw new Error("Ollama: respuesta sin contenido");
    }

    return {
      text: json.message.content,
      tokensInput: json.prompt_eval_count ?? 0,
      tokensOutput: json.eval_count ?? 0,
      modelo: this.modelo,
    };
  }
}
