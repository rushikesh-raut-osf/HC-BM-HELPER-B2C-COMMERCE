import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["\"Space Grotesk\"", "system-ui", "sans-serif"],
        body: ["\"IBM Plex Sans\"", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#0b0f14",
        fog: "#f4f1ec",
        ember: "#f97316",
        tide: "#0ea5a4",
        night: "#111827",
      },
      boxShadow: {
        glow: "0 0 30px rgba(249, 115, 22, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
