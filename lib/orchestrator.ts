import { completeWithNebius } from "@/lib/nebius";
import { searchTavily } from "@/lib/tavily";
import type {
  AgentCredentials,
  AgentEvent,
  AgentStage,
  Citation,
  CriticReport,
  ResearchTask,
  StageTelemetry,
} from "@/lib/types";

function emitStage(
  emit: (event: AgentEvent) => void,
  stage: AgentStage,
  status: "running" | "complete" | "error",
) {
  emit({ type: "stage", stage, status });
}

function parseJsonObject(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("The planning agent returned malformed JSON.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function parseTasks(text: string): ResearchTask[] {
  const parsed = parseJsonObject(text) as { tasks?: unknown };
  if (!Array.isArray(parsed.tasks)) {
    throw new Error("The planning agent response did not contain a tasks array.");
  }
  const tasks = parsed.tasks
    .filter(
      (task): task is { title?: unknown; query?: unknown } =>
        typeof task === "object" && task !== null,
    )
    .map((task) => ({
      title: typeof task.title === "string" ? task.title.trim() : "",
      query: typeof task.query === "string" ? task.query.trim() : "",
    }))
    .filter((task) => task.title && task.query)
    .slice(0, 5);

  if (tasks.length < 3) {
    throw new Error("The planning agent returned fewer than 3 valid research tasks.");
  }
  return tasks;
}

function parseCritic(text: string): CriticReport {
  const parsed = parseJsonObject(text) as {
    score?: unknown;
    assessment?: unknown;
    caveats?: unknown;
  };
  const score = Number(parsed.score);
  if (!Number.isFinite(score) || typeof parsed.assessment !== "string") {
    throw new Error("The critic agent returned an invalid evidence assessment.");
  }
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    assessment: parsed.assessment.trim(),
    caveats: Array.isArray(parsed.caveats)
      ? parsed.caveats.filter((item): item is string => typeof item === "string").slice(0, 8)
      : [],
  };
}

function buildEvidence(sources: Citation[]): string {
  return sources
    .map(
      (source) =>
        `[${source.id}] ${source.title}\nURL: ${source.url}\n` +
        `Date: ${source.publishedDate ?? "not provided"}\nEvidence: ${source.snippet}`,
    )
    .join("\n\n");
}

function savingsEstimate(telemetry: StageTelemetry[]) {
  const priceFactor: Record<string, number> = { nano: 0.1, super: 0.4, ultra: 1 };
  const latencyFactor: Record<string, number> = { nano: 0.25, super: 0.55, ultra: 1 };
  const tierForModel = (model: string) =>
    model.toLowerCase().includes("nano")
      ? "nano"
      : model.toLowerCase().includes("super")
        ? "super"
        : "ultra";

  const allUltraCost = telemetry.reduce(
    (total, metric) => total + metric.promptTokens + metric.completionTokens,
    0,
  );
  const estimatedCost = telemetry.reduce((total, metric) => {
    const factor = priceFactor[tierForModel(metric.model)];
    return total + (metric.promptTokens + metric.completionTokens) * factor;
  }, 0);
  const allUltraLatency = telemetry.reduce((total, metric) => total + metric.latencyMs, 0);
  const estimatedLatency = telemetry.reduce(
    (total, metric) => total + metric.latencyMs * latencyFactor[tierForModel(metric.model)],
    0,
  );
  return {
    cost: allUltraCost
      ? Math.max(0, Math.round(((allUltraCost - estimatedCost) / allUltraCost) * 100))
      : 0,
    latency: allUltraLatency
      ? Math.max(0, Math.round(((allUltraLatency - estimatedLatency) / allUltraLatency) * 100))
      : 0,
  };
}

export async function runResearch(
  goal: string,
  credentials: AgentCredentials,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
) {
  const telemetry: StageTelemetry[] = [];
  const recordTelemetry = (metric: StageTelemetry) => {
    telemetry.push(metric);
    emit({ type: "telemetry", telemetry: metric });
  };
  emit({ type: "stage", stage: "planner", status: "running" });
  const planning = await completeWithNebius({
    stage: "planner",
    tier: "nano",
    apiKey: credentials.nebiusApiKey,
    signal,
    maxTokens: 1_000,
    temperature: 0.1,
    system:
      "You are a research planning agent. Break the user goal into 3 to 5 independent, " +
      "specific web research tasks. Return only valid JSON with shape " +
      '{"tasks":[{"title":"short label","query":"precise search query"}]}.',
    user: goal,
  });
  recordTelemetry(planning.telemetry);
  const tasks = parseTasks(planning.content);
  emit({ type: "plan", tasks });
  emitStage(emit, "planner", "complete");

  emitStage(emit, "grounding", "running");
  const searchStartedAt = performance.now();
  const searchResults = await Promise.all(
    tasks.map((task) => searchTavily(task.query, credentials.tavilyApiKey, signal)),
  );
  recordTelemetry({
    stage: "grounding",
    model: "Tavily Search API",
    latencyMs: Math.max(1, Math.round(performance.now() - searchStartedAt)),
    promptTokens: 0,
    completionTokens: 0,
    tokensPerSecond: 0,
  });
  const unique = new Map<string, Citation>();
  for (const source of searchResults.flat()) {
    if (!unique.has(source.url)) unique.set(source.url, source);
  }
  const sources = [...unique.values()]
    .slice(0, 18)
    .map((source, index) => ({ ...source, id: index + 1 }));
  if (sources.length === 0) {
    throw new Error("Tavily returned no usable sources. Refine the goal and run again.");
  }
  emit({ type: "sources", sources });
  emitStage(emit, "grounding", "complete");

  emitStage(emit, "extractor", "running");
  const extraction = await completeWithNebius({
    stage: "extractor",
    tier: "super",
    apiKey: credentials.nebiusApiKey,
    signal,
    maxTokens: 2_500,
    system:
      "Extract only verifiable, high-signal facts from the provided web sources. " +
      "Deduplicate repeated claims, preserve uncertainty and dates, and attach source IDs " +
      "in square brackets to every factual claim. Never invent evidence.",
    user: buildEvidence(sources),
  });
  recordTelemetry(extraction.telemetry);
  emitStage(emit, "extractor", "complete");

  emitStage(emit, "reasoner", "running");
  const synthesis = await completeWithNebius({
    stage: "reasoner",
    tier: "ultra",
    apiKey: credentials.nebiusApiKey,
    signal,
    maxTokens: 5_000,
    temperature: 0.25,
    system:
      "You are an expert research analyst. Create a useful, structured Markdown deliverable " +
      "answering the goal from the evidence only. Include an executive summary, detailed " +
      "findings, actionable recommendations, important limitations, and a Mermaid diagram in " +
      "a fenced ```mermaid block. Cite factual statements inline using the exact evidence IDs " +
      "like [1]. Do not reveal private chain-of-thought; provide concise conclusions and " +
      "evidence-based rationale. Explicitly label unsupported or time-sensitive claims.",
    user: `GOAL\n${goal}\n\nRESEARCH PLAN\n${JSON.stringify(tasks)}\n\nVERIFIED WEB EVIDENCE\n${extraction.content}`,
  });
  recordTelemetry(synthesis.telemetry);
  emitStage(emit, "reasoner", "complete");

  emitStage(emit, "critic", "running");
  const criticResult = await completeWithNebius({
    stage: "critic",
    tier: "super",
    apiKey: credentials.nebiusApiKey,
    signal,
    maxTokens: 1_200,
    temperature: 0.1,
    system:
      "Evaluate the report only against the provided evidence and sources. Identify unsupported " +
      "or conflicting claims as caveats. Return only JSON: " +
      '{"score":0,"assessment":"short assessment","caveats":["..."]}. Score factual support 0-100.',
    user: `REPORT\n${synthesis.content}\n\nEVIDENCE\n${buildEvidence(sources)}`,
  });
  recordTelemetry(criticResult.telemetry);
  const critic = parseCritic(criticResult.content);
  emitStage(emit, "critic", "complete");

  const sourceList = sources
    .map(
      (source) =>
        `[${source.id}] [${source.title}](${source.url})${source.publishedDate ? ` — ${source.publishedDate}` : ""}`,
    )
    .join("\n");
  const markdown =
    `${synthesis.content}\n\n## Sources\n\n${sourceList}` +
    `\n\n> Evidence review: ${critic.score}/100 — ${critic.assessment}`;
  const savings = savingsEstimate(telemetry);

  emit({
    type: "result",
    markdown,
    critic,
    savings,
  });
}
