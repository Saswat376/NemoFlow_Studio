import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NemoFlow Studio — Research, reason, deliver",
  description:
    "A grounded multi-agent research workspace powered by Nebius Token Factory, NVIDIA Nemotron, and Tavily.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
