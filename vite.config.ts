import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react";
          if (id.includes("node_modules/reactflow")) return "reactflow";
          if (id.includes("node_modules/yaml") || id.includes("node_modules/dagre")) return "yaml";
        },
      },
    },
  },
});
