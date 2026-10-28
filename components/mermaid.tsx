"use client";

import { useEffect, useRef, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const render = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, chart);
        if (active && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError("");
        }
      } catch {
        if (active) setError("Diagram could not be rendered. The source is available below.");
      }
    };
    void render();
    return () => {
      active = false;
    };
  }, [chart]);

  return (
    <div className="my-4 rounded-xl border border-line bg-[#0c0f15] p-4">
      {error ? (
        <p className="text-sm text-amber-300">{error}</p>
      ) : (
        <div ref={containerRef} className="overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full" />
      )}
      {error && <pre className="mt-2 overflow-x-auto text-xs text-muted">{chart}</pre>}
    </div>
  );
}
