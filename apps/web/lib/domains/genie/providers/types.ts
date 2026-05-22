/**
 * Abstraccion de proveedores LLM usados por Genie.
 *
 * Cada provider implementa LLMProvider con un metodo unico generateJson()
 * que recibe (systemPrompt, userPrompt) y devuelve { text, tokensInput,
 * tokensOutput }. El service.ts central elige el provider activo (Claude,
 * Ollama, etc) segun la config en app.ai_providers.
 */

export type LLMGenerationResult = {
  text: string; // texto raw; el service lo parsea como JSON { sql, explicacion }
  tokensInput: number;
  tokensOutput: number;
  modelo: string;
};

export interface LLMProvider {
  /**
   * @throws Error con mensaje friendly si la API falla.
   */
  generateJson(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
  }): Promise<LLMGenerationResult>;
}
