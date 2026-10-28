import OpenAI from "openai";
import type { AgentStage, StageTelemetry } from "@/lib/types";

export type ModelTier = "nano" | "super" | "ultra";

export interface CompletionResult {
  content: string;
  telemetry: StageTelemetry;
}

export interface CompletionOptions {
  stage: AgentStage;
  tier: ModelTier;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  signal?: AbortSignal;
}

const MODEL_ENV: Record<ModelTier, string> = {
  nano: "NEBIUS_MODEL_NANO",
  super: "NEBIUS_MODEL_SUPER",
  ultra: "NEBIUS_MODEL_ULTRA",
};

const FALLBACK_ENV: Record<ModelTier, string> = {
  nano: "NEBIUS_FALLBACK_NANO",
  super: "NEBIUS_FALLBACK_SUPER",
  ultra: "NEBIUS_FALLBACK_ULTRA",
};

const DEFAULT_MODELS: Record<ModelTier, string> = {
  nano: "nvidia/Llama-3.1-Nemotron-Nano-8B-v1",
  super: "nvidia/Llama-3.1-Nemotron-Super-49B-v1",
  ultra: "nvidia/Llama-3.1-Nemotron-Ultra-253B-v1",
};

const DEFAULT_FALLBACKS: Record<ModelTier, ModelTier> = {
  nano: "super",
  super: "nano",
  ultra: "super",
};

function configuredModels(tier: ModelTier): string[] {
  const primary = process.env[MODEL_ENV[tier]]?.trim() || DEFAULT_MODELS[tier];
  const configuredFallbacks = process.env[FALLBACK_ENV[tier]]
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const fallbackTier = DEFAULT_FALLBACKS[tier];
  const fallbacks = configuredFallbacks?.length
    ? configuredFallbacks
    : [process.env[MODEL_ENV[fallbackTier]]?.trim() || DEFAULT_MODELS[fallbackTier]];
  return [...new Set([primary, ...fallbacks])];
}

function createClient(apiKey?: string): OpenAI {
  const key = apiKey?.trim() || process.env.NEBIUS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Nebius API key is missing. Add NEBIUS_API_KEY to the server environment or enter a key in Settings.",
    );
  }

  return new OpenAI({
    apiKey: key,
    baseURL: process.env.NEBIUS_BASE_URL?.trim() || "https://api.studio.nebius.ai/v1",
    timeout: Number(process.env.AGENT_REQUEST_TIMEOUT_MS) || 45_000,
    maxRetries: 1,
  });
}

export async function completeWithNebius(
  options: CompletionOptions,
): Promise<CompletionResult> {
  const client = createClient(options.apiKey);
  const models = configuredModels(options.tier);
  const failures: string[] = [];

  for (const model of models) {
    const startedAt = performance.now();
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 2_500,
      }, { signal: options.signal });

      const content = response.choices[0]?.message.content;
      if (!content?.trim()) {
        throw new Error(`Nebius returned an empty completion for model "${model}".`);
      }

      const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const completionTokens = response.usage?.completion_tokens ?? 0;
      return {
        content,
        telemetry: {
          stage: options.stage,
          model,
          latencyMs,
          promptTokens,
          completionTokens,
          tokensPerSecond: Math.round((completionTokens * 1000) / latencyMs),
        },
      };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${model}: ${detail}`);
    }
  }

  throw new Error(
    `Nebius completion failed for ${options.stage} after trying ${models.length} model(s). ${failures.join(" | ")}`,
  );
}
