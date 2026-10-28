export type AgentStage =
  | "planner"
  | "grounding"
  | "extractor"
  | "reasoner"
  | "critic";

export type StageStatus = "pending" | "running" | "complete" | "error";

export interface ResearchTask {
  title: string;
  query: string;
}

export interface Citation {
  id: number;
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface StageTelemetry {
  stage: AgentStage;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerSecond: number;
}

export interface CriticReport {
  score: number;
  assessment: string;
  caveats: string[];
}

export interface AgentEvent {
  type: "stage" | "plan" | "sources" | "telemetry" | "result" | "error";
  stage?: AgentStage;
  status?: StageStatus;
  tasks?: ResearchTask[];
  sources?: Citation[];
  telemetry?: StageTelemetry;
  markdown?: string;
  critic?: CriticReport;
  savings?: { cost: number; latency: number };
  message?: string;
}

export interface AgentCredentials {
  nebiusApiKey?: string;
  tavilyApiKey?: string;
}
