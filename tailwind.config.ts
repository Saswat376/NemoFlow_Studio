import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#090b10",
        panel: "#11141c",
        line: "#232834",
        muted: "#8b93a5",
        mint: "#77f2c3",
        violet: "#a18aff",
      },
    },
  },
  plugins: [],
};

export default config;
