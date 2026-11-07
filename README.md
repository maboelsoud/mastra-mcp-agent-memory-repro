# Mastra `MCPServer.agents`: the generated `ask_<key>` tool runs the agent without memory

Minimal reproduction for a Mastra issue. An agent configured with `memory: new Memory()`
and exposed through `MCPServer({ agents: { probe } })` forgets everything between two
`ask_probe` calls: the generated tool calls `agent.generate(message, …)` without a thread
or resource id, and nothing sets `MASTRA_THREAD_ID_KEY` / `MASTRA_RESOURCE_ID_KEY` on the
request context, so the agent takes its no-memory path. The same agent called directly
with `memory: { thread, resource }` remembers.

## Run

```sh
npm install
npm start
```

No API key is needed. The default model is a deterministic mock (`src/mock-model.ts`) that
answers from the prompt it is given, so what it "remembers" is exactly what the agent put in
front of it. Set `MODEL=openai/gpt-4o-mini` (or any model-router id you hold a key for) to
use a real model instead.

## Output

```
== Through MCPServer.agents, as the MCP tool `ask_probe`
user  #1: My favourite colour is teal. Confirm in one short sentence.
agent #1: Noted: your favourite colour is teal.
user  #2: What is my favourite colour?
agent #2: I have no record of your favourite colour.
   model saw 1 user message(s) in the second prompt
   threads persisted: 0

== Control: the same agent, called directly with a thread
user  #2: What is my favourite colour?
agent #2: Your favourite colour is teal.
   model saw 2 user message(s) in the second prompt
   threads persisted: 1
```

## Versions

`@mastra/core` 1.82.0, `@mastra/mcp` 2.8.0, `@mastra/memory` 1.41.0, `@mastra/libsql` 1.29.0.
