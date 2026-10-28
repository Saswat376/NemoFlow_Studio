"use client";

import {
  Activity,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  Command,
  Cpu,
  ExternalLink,
  FileText,
  History,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mermaid } from "@/components/mermaid";
import type {
  AgentEvent,
  AgentStage,
  Citation,
  CriticReport,
  ResearchTask,
  StageStatus,
  StageTelemetry,
} from "@/lib/types";

const presets = [
  {
    tag: "CODING & AGENTIC",
    title: "Harden a microservices architecture",
    prompt:
      "Audit this microservices architecture, search live CVE/security advisories via Tavily, and generate hardened production code.",
    icon: LockKeyhole,
    tone: "mint",
  },
  {
    tag: "BEST APPS & AGENTS",
    title: "Explore autonomous AI infrastructure",
    prompt:
      "Perform a deep technical & market due-diligence report on autonomous AI cloud infrastructure in 2026 with architecture diagrams.",
    icon: Activity,
    tone: "violet",
  },
  {
    tag: "PERSONAL AI WORKFLOW",
    title: "Turn reading into a sprint plan",
    prompt:
      "Synthesize my daily technical reading list, extract actionable engineering tasks, and draft a prioritized sprint plan.",
    icon: BookOpen,
    tone: "blue",
  },
] as const;

const stages: { id: AgentStage; title: string; subtitle: string; model: string }[] = [
  { id: "planner", title: "Planner", subtitle: "Task decomposition", model: "NEMOTRON NANO" },
  { id: "grounding", title: "Web grounding", subtitle: "Live Tavily search", model: "TAVILY API" },
  { id: "extractor", title: "Evidence", subtitle: "Signal extraction", model: "NEMOTRON SUPER" },
  { id: "reasoner", title: "Synthesis", subtitle: "Deep reasoning", model: "NEMOTRON ULTRA" },
  { id: "critic", title: "Fact check", subtitle: "Hallucination guard", model: "NEMOTRON SUPER" },
];

type SavedRun = { id: string; title: string; markdown: string; date: string };
const historyKey = "nemoflow-history-v1";

function shortModel(model: string) {
  return model.split("/").pop()?.replace(/-v\d+$/, "") ?? model;
}

function stageModelLabel(stage: AgentStage, telemetry: StageTelemetry[]) {
  const model = telemetry.filter((metric) => metric.stage === stage).at(-1)?.model;
  if (!model) return stages.find((item) => item.id === stage)?.model ?? "";
  if (model.toLowerCase().includes("nano")) return "NEMOTRON NANO";
  if (model.toLowerCase().includes("super")) return "NEMOTRON SUPER";
  if (model.toLowerCase().includes("ultra")) return "NEMOTRON ULTRA";
  return "TAVILY API";
}

export default function Home() {
  const [goal, setGoal] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeStage, setActiveStage] = useState<AgentStage | null>(null);
  const [statuses, setStatuses] = useState<Record<AgentStage, StageStatus>>({
    planner: "pending",
    grounding: "pending",
    extractor: "pending",
    reasoner: "pending",
    critic: "pending",
  });
  const [plan, setPlan] = useState<ResearchTask[]>([]);
  const [sources, setSources] = useState<Citation[]>([]);
  const [telemetry, setTelemetry] = useState<StageTelemetry[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [critic, setCritic] = useState<CriticReport | null>(null);
  const [routingSavings, setRoutingSavings] = useState({ cost: 0, latency: 0 });
  const [error, setError] = useState("");
  const [history, setHistory] = useState<SavedRun[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nebiusKey, setNebiusKey] = useState("");
  const [tavilyKey, setTavilyKey] = useState("");
  const [keysConfigured, setKeysConfigured] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"report" | "sources">("report");
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(historyKey);
      if (stored) setHistory(JSON.parse(stored) as SavedRun[]);
      setKeysConfigured(
        Boolean(sessionStorage.getItem("nemoflow-nebius-key") || sessionStorage.getItem("nemoflow-tavily-key")),
      );
    } catch {
      setError("Browser storage is unavailable; this session will not persist across reloads.");
    }
  }, []);

  const metrics = useMemo(() => {
    const completed = telemetry.length;
    const tokens = telemetry.reduce(
      (sum, metric) => sum + metric.promptTokens + metric.completionTokens,
      0,
    );
    const elapsed = telemetry.reduce((sum, metric) => sum + metric.latencyMs, 0);
    return {
      completed,
      tokens,
      elapsed,
      averageTps: telemetry.some((metric) => metric.completionTokens > 0)
        ? Math.round(
            telemetry.reduce((sum, metric) => sum + metric.tokensPerSecond, 0) /
              telemetry.filter((metric) => metric.completionTokens > 0).length,
          )
        : 0,
    };
  }, [telemetry]);

  const applyPreset = (prompt: string) => {
    setGoal(prompt);
    textareaRef.current?.focus();
    setSidebarOpen(false);
  };

  const saveRun = useCallback((nextMarkdown: string, runGoal: string) => {
    const item: SavedRun = {
      id: crypto.randomUUID(),
      title: runGoal.slice(0, 72),
      markdown: nextMarkdown,
      date: new Date().toISOString(),
    };
    setHistory((previous) => {
      const next = [item, ...previous].slice(0, 20);
      try {
        localStorage.setItem(historyKey, JSON.stringify(next));
      } catch {
        setError("Could not save this run: browser storage is unavailable or full.");
      }
      return next;
    });
  }, []);

  const run = async (input = goal) => {
    const cleanGoal = input.trim();
    if (!cleanGoal || isRunning) return;
    setGoal(cleanGoal);
    setIsRunning(true);
    setError("");
    setMarkdown("");
    setPlan([]);
    setSources([]);
    setTelemetry([]);
    setCritic(null);
    setRoutingSavings({ cost: 0, latency: 0 });
    setStatuses({
      planner: "pending",
      grounding: "pending",
      extractor: "pending",
      reasoner: "pending",
      critic: "pending",
    });
    setActiveTab("report");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(sessionStorage.getItem("nemoflow-nebius-key")
            ? { "x-nebius-api-key": sessionStorage.getItem("nemoflow-nebius-key") as string }
            : {}),
          ...(sessionStorage.getItem("nemoflow-tavily-key")
            ? { "x-tavily-api-key": sessionStorage.getItem("nemoflow-tavily-key") as string }
            : {}),
        },
        body: JSON.stringify({ goal: cleanGoal }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || `Run request failed (${response.status}).`);
      }
      if (!response.body) throw new Error("The server did not start an event stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completedReport = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";
        for (const message of messages) {
          const line = message.split("\n").find((part) => part.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as AgentEvent;
          if (event.type === "stage" && event.stage && event.status) {
            setStatuses((previous) => ({ ...previous, [event.stage as AgentStage]: event.status as StageStatus }));
            setActiveStage(event.status === "running" ? event.stage : null);
          } else if (event.type === "plan") {
            setPlan(event.tasks ?? []);
          } else if (event.type === "sources") {
            setSources(event.sources ?? []);
          } else if (event.type === "telemetry" && event.telemetry) {
            setTelemetry((previous) => [...previous, event.telemetry as StageTelemetry]);
          } else if (event.type === "result" && event.markdown) {
            completedReport = event.markdown;
            setMarkdown(event.markdown);
            setCritic(event.critic ?? null);
            setRoutingSavings(event.savings ?? { cost: 0, latency: 0 });
            setActiveStage(null);
          } else if (event.type === "error") {
            throw new Error(event.message || "The agent run failed.");
          }
        }
      }
      if (completedReport) saveRun(completedReport, cleanGoal);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setError("Run cancelled.");
      } else {
        setError(caught instanceof Error ? caught.message : "The agent run failed.");
      }
      setActiveStage(null);
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const saveKeys = () => {
    try {
      if (nebiusKey.trim()) sessionStorage.setItem("nemoflow-nebius-key", nebiusKey.trim());
      else sessionStorage.removeItem("nemoflow-nebius-key");
      if (tavilyKey.trim()) sessionStorage.setItem("nemoflow-tavily-key", tavilyKey.trim());
      else sessionStorage.removeItem("nemoflow-tavily-key");
      setKeysConfigured(Boolean(nebiusKey.trim() || tavilyKey.trim()));
      setNebiusKey("");
      setTavilyKey("");
      setSettingsOpen(false);
      setError("");
    } catch {
      setError("Could not save keys in this browser session.");
    }
  };

  const loadHistory = (item: SavedRun) => {
    setGoal(item.title);
    setMarkdown(item.markdown);
    setError("");
    setSidebarOpen(false);
  };

  const hasRun = isRunning || markdown.length > 0 || telemetry.length > 0 || Boolean(error);

  return (
    <main className="min-h-screen bg-ink text-white">
      {sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/70 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-line bg-[#0c0e14] transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[72px] items-center gap-3 border-b border-line px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint text-[#101b19]"><Sparkles size={18} /></div>
          <div><p className="text-sm font-semibold tracking-tight">NemoFlow <span className="text-mint">Studio</span></p><p className="mt-0.5 text-[10px] uppercase tracking-[.18em] text-muted">Research workspace</p></div>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto text-muted lg:hidden"><X size={18} /></button>
        </div>
        <div className="p-3">
          <button onClick={() => { setGoal(""); setMarkdown(""); setError(""); setSidebarOpen(false); }} className="flex w-full items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2.5 text-xs font-medium text-slate-200 transition hover:border-[#394050]">
            <Plus size={15} className="text-mint" /> New research run <span className="ml-auto text-[10px] text-muted"><Command size={12} /></span>
          </button>
        </div>
        <div className="px-5 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[.17em] text-muted">Workspace</div>
        <nav className="space-y-1 px-3">
          <button className="flex w-full items-center gap-3 rounded-lg bg-[#1a1e29] px-3 py-2.5 text-left text-xs text-white"><Activity size={15} className="text-mint" /> Agent runs <span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">Live</span></button>
          <button onClick={() => setSettingsOpen(true)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-muted transition hover:bg-white/5 hover:text-white"><Settings2 size={15} /> Model & API settings</button>
        </nav>
        <div className="mt-7 flex items-center justify-between px-5 pb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[.17em] text-muted">Recent runs</span><History size={13} className="text-muted" />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          {history.length ? history.map((item) => (
            <button key={item.id} onClick={() => loadHistory(item)} className="group mb-1 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition hover:bg-white/5">
              <FileText size={14} className="mt-0.5 shrink-0 text-muted group-hover:text-mint" />
              <span className="min-w-0"><span className="block truncate text-xs text-slate-300">{item.title}</span><span className="mt-1 block text-[10px] text-muted">{new Date(item.date).toLocaleDateString()}</span></span>
            </button>
          )) : <p className="px-3 py-3 text-xs leading-5 text-muted">Your completed research runs will appear here.</p>}
        </div>
        <div className="border-t border-line p-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-panel p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet/15 text-violet"><Cpu size={15} /></div>
            <div className="min-w-0 flex-1"><p className="text-[11px] font-medium">Nebius Token Factory</p><p className="mt-0.5 truncate text-[10px] text-muted">NVIDIA Nemotron · Tavily</p></div>
            <span className="h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_8px_#77f2c3]" />
          </div>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[260px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-line bg-ink/90 px-5 backdrop-blur-xl md:px-8">
          <div className="flex items-center gap-3"><button onClick={() => setSidebarOpen(true)} className="text-muted lg:hidden"><Menu size={19} /></button><div className="hidden items-center gap-2 text-xs text-muted sm:flex"><span>Workspace</span><span className="text-[#4d5564]">/</span><span className="text-white">Deep research</span></div><div className="sm:hidden text-sm font-medium">NemoFlow Studio</div></div>
          <div className="flex items-center gap-2.5">
            <span className="hidden items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1.5 text-[10px] text-muted sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-mint" /> Nebius connected</span>
            <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-slate-300 transition hover:border-[#394050]"><KeyRound size={14} className={keysConfigured ? "text-mint" : "text-muted"} /> <span className="hidden sm:inline">{keysConfigured ? "Keys configured" : "API settings"}</span><ChevronDown size={13} /></button>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 pb-14 md:px-8">
          {!hasRun && (
            <section className="mx-auto max-w-[900px] pb-10 pt-16 md:pt-24">
              <div className="mb-6 flex items-center justify-center"><span className="inline-flex items-center gap-2 rounded-full border border-mint/20 bg-mint/[.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-mint"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint" /> Multi-agent research, grounded live</span></div>
              <h1 className="mx-auto max-w-3xl text-center text-4xl font-semibold leading-[1.13] tracking-[-.045em] sm:text-5xl md:text-[58px]">From complex questions<br className="hidden sm:block" /> to <span className="bg-gradient-to-r from-mint to-[#a5f8d7] bg-clip-text text-transparent">grounded decisions.</span></h1>
              <p className="mx-auto mt-5 max-w-xl text-center text-sm leading-6 text-muted">A Nemotron-powered agent team that plans, searches the live web, and turns evidence into work you can act on.</p>
              <div className="mt-10 overflow-hidden rounded-2xl border border-[#2b303c] bg-[#11141c] shadow-[0_24px_100px_rgba(0,0,0,.28)] focus-within:border-[#495264]">
                <textarea ref={textareaRef} value={goal} onChange={(event) => setGoal(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run(); }} placeholder="What should your agent team investigate?" rows={3} className="w-full resize-none bg-transparent px-5 pt-5 text-sm leading-6 text-white outline-none placeholder:text-[#646b79]" />
                <div className="flex items-center justify-between border-t border-line px-4 py-3"><div className="flex items-center gap-2 text-[10px] text-muted"><Search size={13} /><span>Web-grounded research</span><span className="text-[#4d5564]">·</span><span>Ctrl + Enter to run</span></div><button onClick={() => void run()} disabled={!goal.trim()} className="flex items-center gap-2 rounded-lg bg-mint px-3.5 py-2 text-xs font-semibold text-[#07120e] transition hover:bg-[#9cf7d5] disabled:cursor-not-allowed disabled:opacity-40"><Sparkles size={14} /> Start research <ArrowUp size={14} /></button></div>
              </div>
              <div className="mt-10 flex items-center justify-center gap-3"><span className="h-px w-8 bg-line" /><span className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Judge demo presets</span><span className="h-px w-8 bg-line" /></div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {presets.map((preset, index) => {
                  const Icon = preset.icon;
                  return <motion.button key={preset.tag} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }} onClick={() => applyPreset(preset.prompt)} className="group rounded-xl border border-line bg-[#10131a] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#424959] hover:bg-[#151923]">
                    <div className="flex items-center justify-between"><span className={`text-[9px] font-semibold tracking-[.12em] ${preset.tone === "mint" ? "text-mint" : preset.tone === "violet" ? "text-violet" : "text-blue-300"}`}>{preset.tag}</span><Icon size={15} className="text-muted transition group-hover:text-white" /></div>
                    <p className="mt-4 text-sm font-medium leading-5 text-slate-200">{preset.title}</p><p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted">Load the prompt and run your live research pipeline.</p>
                  </motion.button>;
                })}
              </div>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[10px] text-muted"><span className="inline-flex items-center gap-1.5"><Zap size={12} className="text-mint" /> Smart model routing</span><span className="inline-flex items-center gap-1.5"><Radio size={12} className="text-violet" /> Live web grounding</span><span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} className="text-blue-300" /> Evidence review</span></div>
            </section>
          )}

          {hasRun && (
            <section className="pt-8">
              <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
                <div><div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-mint"><Sparkles size={12} /> Research workspace</div><h1 className="max-w-3xl text-xl font-semibold tracking-tight md:text-2xl">{goal || "Research run"}</h1><p className="mt-2 text-xs text-muted">{isRunning ? "Agents are working through your research pipeline." : markdown ? "Research complete · evidence reviewed" : "Run a prompt to begin your research."}</p></div>
                <div className="flex items-center gap-2"><button onClick={() => { setGoal(""); setMarkdown(""); setError(""); }} className="rounded-lg border border-line px-3 py-2 text-xs text-slate-300 hover:bg-white/5">New run</button><button onClick={() => setSettingsOpen(true)} className="rounded-lg border border-line p-2 text-muted hover:text-white"><Settings2 size={15} /></button></div>
              </div>
              <div className="grid gap-5 xl:grid-cols-[minmax(330px,.82fr)_minmax(0,1.65fr)]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-line bg-panel p-5">
                    <div className="mb-5 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Agent workflow</h2><p className="mt-1 text-[10px] text-muted">Cascade routing · live execution</p></div><span className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-wider ${isRunning ? "bg-mint/10 text-mint" : markdown ? "bg-mint/10 text-mint" : "bg-white/5 text-muted"}`}><span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "animate-pulse bg-mint" : markdown ? "bg-mint" : "bg-muted"}`} />{isRunning ? "Running" : markdown ? "Complete" : "Ready"}</span></div>
                    <div className="relative space-y-0 before:absolute before:left-[15px] before:top-5 before:h-[calc(100%-42px)] before:w-px before:bg-[#2b303a]">
                      {stages.map((stage) => {
                        const status = statuses[stage.id];
                        const active = activeStage === stage.id && isRunning;
                        const Icon = stage.id === "planner" ? Sparkles : stage.id === "grounding" ? Search : stage.id === "extractor" ? FileText : stage.id === "reasoner" ? Cpu : ShieldCheck;
                        return <div key={stage.id} className="relative flex gap-3 pb-5 last:pb-0">
                          <div className={`relative z-10 flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-lg border ${active ? "border-mint/50 bg-mint/10 text-mint" : status === "complete" ? "border-mint/20 bg-mint/[.07] text-mint" : status === "error" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-line bg-[#171a22] text-muted"}`}>{status === "complete" ? <Check size={14} /> : status === "error" ? <X size={14} /> : active ? <LoaderCircle size={14} className="animate-spin" /> : <Icon size={14} />}</div>
                          <div className="min-w-0 flex-1 pt-0.5"><div className="flex items-start justify-between gap-2"><div><p className={`text-xs font-medium ${active || status === "complete" ? "text-white" : "text-slate-400"}`}>{stage.title}</p><p className="mt-1 text-[10px] text-muted">{stage.subtitle}</p></div><span className={`text-[8px] font-semibold tracking-[.09em] ${stage.id === "planner" || stage.id === "extractor" || stage.id === "reasoner" || stage.id === "critic" ? "text-violet/80" : "text-slate-400"}`}>{stageModelLabel(stage.id, telemetry)}</span></div>
                            {stage.id === "planner" && plan.length > 0 && <div className="mt-2 space-y-1">{plan.map((task, taskIndex) => <p key={`${task.title}-${taskIndex}`} className="truncate text-[10px] text-muted"><span className="mr-1 text-mint/70">{String(taskIndex + 1).padStart(2, "0")}</span>{task.title}</p>)}</div>}
                          </div>
                        </div>;
                      })}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-line bg-panel p-5">
                    <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Token Factory telemetry</h2><p className="mt-1 text-[10px] text-muted">Per-stage inference metrics</p></div><Activity size={15} className="text-mint" /></div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-line bg-[#0d1016] p-3"><p className="text-[9px] text-muted">Tokens</p><p className="mt-1 text-sm font-semibold tabular-nums">{metrics.tokens.toLocaleString()}</p></div>
                      <div className="rounded-lg border border-line bg-[#0d1016] p-3"><p className="text-[9px] text-muted">Avg tok/s</p><p className="mt-1 text-sm font-semibold tabular-nums">{metrics.averageTps}</p></div>
                      <div className="rounded-lg border border-line bg-[#0d1016] p-3"><p className="text-[9px] text-muted">LLM latency</p><p className="mt-1 text-sm font-semibold tabular-nums">{metrics.elapsed ? `${(metrics.elapsed / 1000).toFixed(1)}s` : "—"}</p></div>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg border border-mint/15 bg-mint/[.045] px-3 py-2.5"><div className="flex items-center gap-2"><Zap size={13} className="text-mint" /><span className="text-[10px] font-medium text-slate-200">Smart routing savings</span></div><span className="text-[10px] font-semibold text-mint">~{routingSavings.cost}% cost · ~{routingSavings.latency}% latency</span></div>
                    <p className="mt-2 text-[9px] leading-4 text-muted">Estimated vs. all-Ultra routing using relative tier multipliers; actual provider billing varies.</p>
                    {telemetry.length > 0 && <div className="mt-4 space-y-2 border-t border-line pt-3">{telemetry.map((item, index) => <div key={`${item.stage}-${index}`} className="flex items-center justify-between gap-2 text-[9px]"><span className="truncate text-slate-300">{stages.find((stage) => stage.id === item.stage)?.title}</span><span className="truncate text-muted">{shortModel(item.model)}</span><span className="shrink-0 tabular-nums text-muted">{item.latencyMs}ms · {item.tokensPerSecond} tok/s</span></div>)}</div>}
                  </div>
                  {critic && <div className="rounded-2xl border border-line bg-panel p-5"><div className="flex items-center gap-2"><ShieldCheck size={15} className="text-mint" /><h2 className="text-sm font-semibold">Evidence review</h2><span className="ml-auto rounded-full bg-mint/10 px-2 py-1 text-[10px] font-semibold text-mint">{critic.score}/100</span></div><p className="mt-3 text-xs leading-5 text-slate-300">{critic.assessment}</p>{critic.caveats.length > 0 && <ul className="mt-3 space-y-2">{critic.caveats.map((caveat, index) => <li key={index} className="flex gap-2 text-[10px] leading-4 text-amber-200/80"><Circle size={5} className="mt-1.5 shrink-0 fill-current" />{caveat}</li>)}</ul>}</div>}
                </div>

                <div className="min-h-[550px] overflow-hidden rounded-2xl border border-line bg-panel">
                  <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="text-sm font-semibold">Deliverable</h2><p className="mt-1 text-[10px] text-muted">{markdown ? "Evidence-backed report · Markdown" : isRunning ? "The final report will appear after evidence review." : "Your report will appear here."}</p></div><div className="flex items-center gap-1 rounded-lg border border-line bg-[#0d1016] p-1"><button onClick={() => setActiveTab("report")} className={`rounded-md px-2.5 py-1.5 text-[10px] ${activeTab === "report" ? "bg-[#242a35] text-white" : "text-muted"}`}>Report</button><button onClick={() => setActiveTab("sources")} className={`rounded-md px-2.5 py-1.5 text-[10px] ${activeTab === "sources" ? "bg-[#242a35] text-white" : "text-muted"}`}>Sources <span className="ml-1 text-muted">{sources.length || ""}</span></button></div></div>
                  {error && <div role="alert" className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/[.07] p-3 text-xs leading-5 text-red-200"><X size={14} className="mt-0.5 shrink-0" />{error}</div>}
                  {isRunning && !markdown && <div className="flex items-center gap-3 border-b border-line px-5 py-3 text-[10px] text-muted"><LoaderCircle size={13} className="animate-spin text-mint" />{activeStage ? stages.find((stage) => stage.id === activeStage)?.subtitle : "Preparing agents"}<button onClick={() => abortRef.current?.abort()} className="ml-auto text-muted hover:text-white">Cancel</button></div>}
                  {activeTab === "report" ? markdown ? <article className="markdown-body px-5 py-6 md:px-8"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code({ className, children, ...props }) { const match = /language-(\w+)/.exec(className || ""); const value = String(children).replace(/\n$/, ""); if (match?.[1] === "mermaid") return <Mermaid chart={value} />; return <code className={className} {...props}>{children}</code>; }, a({ children, href, ...props }) { return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>; } }}>{markdown}</ReactMarkdown></article> : <div className="flex min-h-[480px] flex-col items-center justify-center px-6 text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-[#0d1016] text-muted">{isRunning ? <LoaderCircle size={20} className="animate-spin text-mint" /> : <FileText size={20} />}</div><p className="text-sm font-medium text-slate-300">{isRunning ? "Research in progress" : "Ready when you are"}</p><p className="mt-2 max-w-xs text-xs leading-5 text-muted">{isRunning ? "The pipeline streams its progress on the left. Your report appears here after the critic review." : "Start a research run or select one of the demo presets to generate a cited report."}</p></div> : <div className="p-5 md:p-8">{sources.length ? <div className="space-y-3">{sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="group block rounded-xl border border-line bg-[#0d1016] p-4 transition hover:border-[#404858]"><div className="flex items-start gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet/10 text-[10px] font-semibold text-violet">[{source.id}]</span><div className="min-w-0 flex-1"><h3 className="text-xs font-medium leading-5 text-slate-200 group-hover:text-mint">{source.title}</h3><p className="mt-1 line-clamp-3 text-[10px] leading-5 text-muted">{source.snippet}</p><div className="mt-2 flex items-center gap-1.5 truncate text-[9px] text-mint/70"><ExternalLink size={10} />{source.url}</div></div></div></a>)}</div> : <div className="flex min-h-[400px] flex-col items-center justify-center text-center"><Search size={20} className="text-muted" /><p className="mt-3 text-sm text-slate-300">Sources will appear here</p><p className="mt-1 text-xs text-muted">The Tavily agent retrieves live web evidence.</p></div>}</div>}
                </div>
              </div>
              {isRunning && <div className="mt-5 flex justify-end"><button onClick={() => abortRef.current?.abort()} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-muted hover:text-white"><X size={13} /> Cancel run</button></div>}
              {!isRunning && markdown && <div className="mt-4 flex justify-end"><span className="inline-flex items-center gap-2 px-2 py-2 text-[10px] text-muted"><Check size={12} className="text-mint" />Run saved to browser history</span></div>}
            </section>
          )}
        </div>
      </div>

      {settingsOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="w-full max-w-md rounded-2xl border border-line bg-[#11141c] p-6 shadow-2xl">
          <div className="flex items-start justify-between"><div><div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-violet/10 text-violet"><KeyRound size={17} /></div><h2 id="settings-title" className="text-base font-semibold">API key settings</h2><p className="mt-1 text-xs leading-5 text-muted">Server environment keys are used by default. Session keys override them and stay in this browser tab.</p></div><button onClick={() => setSettingsOpen(false)} className="text-muted hover:text-white"><X size={17} /></button></div>
          <div className="mt-6 space-y-4"><label className="block"><span className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-200">Nebius Token Factory key<span className="text-[9px] font-normal text-muted">optional override</span></span><input type="password" autoComplete="off" value={nebiusKey} onChange={(event) => setNebiusKey(event.target.value)} placeholder={keysConfigured ? "Saved in this tab (enter to replace)" : "Uses server NEBIUS_API_KEY"} className="w-full rounded-lg border border-line bg-[#0b0e13] px-3 py-2.5 text-xs text-white outline-none placeholder:text-muted focus:border-violet/50" /></label><label className="block"><span className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-200">Tavily Search key<span className="text-[9px] font-normal text-muted">optional override</span></span><input type="password" autoComplete="off" value={tavilyKey} onChange={(event) => setTavilyKey(event.target.value)} placeholder={keysConfigured ? "Saved in this tab (enter to replace)" : "Uses server TAVILY_API_KEY"} className="w-full rounded-lg border border-line bg-[#0b0e13] px-3 py-2.5 text-xs text-white outline-none placeholder:text-muted focus:border-violet/50" /></label></div>
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-line bg-[#0d1016] p-3 text-[10px] leading-4 text-muted"><LockKeyhole size={13} className="mt-0.5 shrink-0 text-mint" />Keys are sent only to this app&apos;s server over your connection. Overrides are held in session storage, never localStorage.</div>
          <div className="mt-6 flex justify-end gap-2"><button onClick={() => setSettingsOpen(false)} className="rounded-lg px-3 py-2 text-xs text-muted hover:text-white">Cancel</button><button onClick={saveKeys} className="rounded-lg bg-mint px-3.5 py-2 text-xs font-semibold text-[#07120e] hover:bg-[#9cf7d5]">Save for this tab</button></div>
        </div>
      </div>}
    </main>
  );
}
