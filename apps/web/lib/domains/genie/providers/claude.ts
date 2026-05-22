import Anthropic from "@anthropic-ai/sdk";

import type { LLMGenerationResult, LLMProvider } from "./types";

export class ClaudeProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly modelo: string,
  ) {}

  async generateJson(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
  }): Promise<LLMGenerationResult> {
    const client = new Anthropic({ apiKey: this.apiKey });
    const response = await client.messages.create({
      model: this.modelo,
      max_tokens: args.maxTokens,
      system: [
        {
          type: "text",
          text: args.systemPrompt,
          // Prompt caching: catalog snapshot cambia raramente
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: args.userPrompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude no devolvio bloque de texto");
    }
    return {
      text: textBlock.text,
      tokensInput: response.usage.input_tokens ?? 0,
      tokensOutput: response.usage.output_tokens ?? 0,
      modelo: this.modelo,
    };
  }
}
