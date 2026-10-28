import type { Citation } from "@/lib/types";

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
  published_date?: string | null;
}

interface TavilyResponse {
  results?: TavilySearchResult[];
}

export async function searchTavily(
  query: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<Citation[]> {
  const key = apiKey?.trim() || process.env.TAVILY_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Tavily API key is missing. Add TAVILY_API_KEY to the server environment or enter a key in Settings.",
    );
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "advanced",
      include_raw_content: true,
      max_results: 5,
    }),
    signal: signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(Number(process.env.AGENT_REQUEST_TIMEOUT_MS) || 45_000),
        ])
      : AbortSignal.timeout(Number(process.env.AGENT_REQUEST_TIMEOUT_MS) || 45_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(`Tavily search failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as TavilyResponse;
  return (data.results ?? [])
    .filter((result) => result.url && (result.raw_content || result.content))
    .map((result) => ({
      id: 0,
      title: result.title?.trim() || result.url || "Untitled source",
      url: result.url as string,
      snippet: (result.raw_content || result.content || "").trim().slice(0, 8_000),
      publishedDate: result.published_date || undefined,
    }));
}
