import { runResearch } from "@/lib/orchestrator";
import type { AgentCredentials, AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const encoder = new TextEncoder();

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("goal" in payload) ||
    typeof payload.goal !== "string" ||
    !payload.goal.trim() ||
    payload.goal.length > 12_000
  ) {
    return Response.json(
      { error: "Provide a non-empty goal with at most 12,000 characters." },
      { status: 400 },
    );
  }

  const credentials: AgentCredentials = {
    nebiusApiKey: request.headers.get("x-nebius-api-key") || undefined,
    tavilyApiKey: request.headers.get("x-tavily-api-key") || undefined,
  };
  const goal = payload.goal.trim();
  const runAbort = new AbortController();
  let cancelled = false;
  let currentStage: AgentEvent["stage"];
  request.signal.addEventListener("abort", () => runAbort.abort(request.signal.reason), {
    once: true,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        if (cancelled || runAbort.signal.aborted) return;
        if (event.type === "stage" && event.stage && event.status === "running") {
          currentStage = event.stage;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runResearch(goal, credentials, send, runAbort.signal);
      } catch (error) {
        if (runAbort.signal.aborted) return;
        if (currentStage) send({ type: "stage", stage: currentStage, status: "error" });
        const message = error instanceof Error ? error.message : "The agent run failed.";
        send({ type: "error", message });
      } finally {
        if (!cancelled && !runAbort.signal.aborted) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      runAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
