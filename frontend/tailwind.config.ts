import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["\"Plus Jakarta Sans\"", "system-ui", "sans-serif"],
        body: ["\"Manrope\"", "system-ui", "sans-serif"],
      },
      colors: {
        obsidian: "#0b1220",
        midnight: "#101a2b",
        steel: "#1f2a44",
        paper: "#f5f4ef",
        slate: "#cbd5f5",
        signal: "#2563eb",
        gold: "#f6c453",
        mint: "#14b8a6",
        amber: "#f59e0b",
        rose: "#f43f5e",
      },
      boxShadow: {
        glow: "0 20px 60px rgba(37, 99, 235, 0.18)",
        lift: "0 18px 40px rgba(12, 18, 32, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
