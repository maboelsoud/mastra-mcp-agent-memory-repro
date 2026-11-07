import http from "node:http";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { MCPClient, MCPServer } from "@mastra/mcp";
import { Memory } from "@mastra/memory";
import { mockModel } from "./mock-model.js";

// No key needed: the default model is a deterministic mock that answers from
// the prompt it receives. Set MODEL=openai/gpt-4o-mini (etc.) to use a real one.
let userMessagesSeen = 0;
const model = process.env.MODEL ?? mockModel((n) => (userMessagesSeen = n));

const TELL = "My favourite colour is teal. Confirm in one short sentence.";
const ASK = "What is my favourite colour?";

const storage = new LibSQLStore({ id: "repro", url: ":memory:" });

const probe = new Agent({
  id: "probe",
  name: "Probe",
  description:
    "Answers questions and remembers what the user said earlier in the conversation.",
  instructions:
    "Answer in one short sentence. If asked about something the user told you " +
    "earlier, repeat it exactly; if you have no record of it, say so plainly.",
  model,
  memory: new Memory(),
});

const server = new MCPServer({
  id: "repro",
  name: "Repro",
  version: "1.0.0",
  tools: {},
  agents: { probe }, // served as the `ask_probe` tool
});

// Registering the agent gives its Memory the storage; registering the server traces it.
new Mastra({ agents: { probe }, storage, mcpServers: { repro: server } });

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  void server.startHTTP({ url, httpPath: "/mcp", req, res });
});
await new Promise<void>((resolve) => httpServer.listen(0, resolve));
const { port } = httpServer.address() as { port: number };

const client = new MCPClient({
  id: "repro-client",
  servers: { repro: { url: new URL(`http://localhost:${port}/mcp`) } },
});
const tools = await client.listTools();
const askProbe = tools["repro_ask_probe"];
if (!askProbe?.execute) throw new Error(`ask_probe not served; got ${Object.keys(tools)}`);
type ExecuteContext = Parameters<NonNullable<typeof askProbe.execute>>[1];
const call = (message: string) => askProbe.execute!({ message }, {} as ExecuteContext);

const memoryStore = await storage.getStore("memory");
const threadCount = async () =>
  (await memoryStore!.listThreads({ perPage: 100 })).threads.length;

console.log("\n== Through MCPServer.agents, as the MCP tool `ask_probe`");
console.log("user  #1:", TELL);
console.log("agent #1:", text(await call(TELL)));
console.log("user  #2:", ASK);
console.log("agent #2:", text(await call(ASK)));
console.log(`   model saw ${userMessagesSeen} user message(s) in the second prompt`);
console.log("   threads persisted:", await threadCount());

console.log("\n== Control: the same agent, called directly with a thread");
const memory = { thread: "thread-1", resource: "user-1" };
await probe.generate(TELL, { memory });
const control = await probe.generate(ASK, { memory });
console.log("user  #2:", ASK);
console.log("agent #2:", control.text);
console.log(`   model saw ${userMessagesSeen} user message(s) in the second prompt`);
console.log("   threads persisted:", await threadCount());

await client.disconnect();
await server.close();
httpServer.close();

/** The assistant text out of whatever shape the client hands back. */
function text(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as { text?: unknown; content?: unknown };
    if (typeof r.text === "string") return r.text;
    if (Array.isArray(r.content)) {
      const joined = (r.content as Array<{ type?: string; text?: string }>)
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n");
      // The generate result arrives serialized as JSON text; pull its `text`.
      try {
        const parsed = JSON.parse(joined) as { text?: unknown };
        if (typeof parsed.text === "string") return parsed.text;
      } catch {
        /* plain text */
      }
      return joined;
    }
  }
  return JSON.stringify(result);
}
