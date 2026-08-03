/**
 * AnthropicProvider — implementacion Claude via oficial SDK.
 *
 * Pricing hardcodeado para calculo de costo en report_insights.
 * Actualizar cuando Anthropic cambie tarifas (Claude API pricing page).
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import {
  LlmAuthError,
  LlmProviderError,
  LlmRateLimitError,
  type InsightsProvider,
  type GenerateResult,
} from "./base";
import type { GenerateOptions } from "../types";

// Pricing USD por 1M tokens (source: docs.anthropic.com/en/docs/about-claude/pricing)
// Actualizado 2026-08. Si cambian tarifas, ajustar aca.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5":    { input: 0.25, output: 1.25 },
  "claude-haiku-4-5-20251001": { input: 0.25, output: 1.25 },
  "claude-sonnet-4-6":   { input: 3.00, output: 15.00 },
  "claude-opus-4-7":     { input: 15.00, output: 75.00 },
};

export class AnthropicProvider implements InsightsProvider {
  readonly name: string;
  private client: Anthropic;
  private model: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(opts: {
    apiKey: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
  }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.defaultMaxTokens = opts.maxTokens ?? 800;
    this.defaultTemperature = opts.temperature ?? 0.3;
    this.name = `anthropic/${opts.model}`;
  }

  async generate(prompt: string, opts?: GenerateOptions): Promise<GenerateResult> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: opts?.maxTokens ?? this.defaultMaxTokens,
        temperature: opts?.temperature ?? this.defaultTemperature,
        system: opts?.system,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock && "text" in textBlock ? textBlock.text : "";

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const costUsd = this.calculateCost(inputTokens, outputTokens);

      return {
        text,
        usage: { inputTokens, outputTokens, costUsd },
        model: this.model,
        finishReason: response.stop_reason ?? "unknown",
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async testConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      // Prompt minimo para validar auth + reachability sin gastar tokens
      await this.client.messages.create({
        model: this.model,
        max_tokens: 5,
        messages: [{ role: "user", content: "hi" }],
      });
      return { ok: true };
    } catch (err) {
      const mapped = this.mapError(err);
      return { ok: false, error: mapped.message };
    }
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const pricing = PRICING[this.model] ?? PRICING["claude-haiku-4-5"]!;
    return (
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output
    );
  }

  private mapError(err: unknown): LlmProviderError {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 401 || err.status === 403) {
        return new LlmAuthError(this.name, err);
      }
      if (err.status === 429) {
        return new LlmRateLimitError(this.name, err);
      }
      return new LlmProviderError(
        `Anthropic API error ${err.status}: ${err.message}`,
        this.name,
        err,
      );
    }
    return new LlmProviderError(
      err instanceof Error ? err.message : String(err),
      this.name,
      err,
    );
  }
}
