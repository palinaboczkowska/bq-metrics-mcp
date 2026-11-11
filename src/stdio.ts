// Local use from Claude Code / Claude Desktop: `npm run dev:stdio`.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { warehouseFromEnv } from "./config.js";
import { createServer } from "./server.js";

const server = createServer(warehouseFromEnv());
await server.connect(new StdioServerTransport());
