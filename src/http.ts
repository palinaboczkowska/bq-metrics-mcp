// Streamable HTTP for Cloud Run. Stateless: a fresh server and transport per request.
// Authentication is handled by Cloud Run IAM (deployed with --no-allow-unauthenticated).
import { createServer as createHttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { warehouseFromEnv } from "./config.js";
import { createServer } from "./server.js";

const warehouse = warehouseFromEnv();
const port = Number(process.env.PORT ?? 8080);

createHttpServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.url !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" }).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400).end("Invalid JSON");
    return;
  }
  const server = createServer(warehouse);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}).listen(port, () => console.error(`bq-metrics-mcp listening on :${port}/mcp`));
