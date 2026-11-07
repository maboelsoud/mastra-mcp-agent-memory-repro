import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

/**
 * A deterministic stand-in for an LLM so the repro needs no API key. It answers
 * from the prompt it is given, the way a real model would: it "remembers" the
 * colour only when an earlier user message in the prompt mentions it. Memory is
 * therefore observable as what the agent puts in front of the model.
 */
export function mockModel(onCall: (userMessagesInPrompt: number) => void): LanguageModelV3 {
  const reply = (options: LanguageModelV3CallOptions) => {
    const userTexts = options.prompt
      .filter((m) => m.role === "user")
      .map((m) => m.content.map((p) => (p.type === "text" ? p.text : "")).join(" "));
    onCall(userTexts.length);
    const last = userTexts.at(-1) ?? "";
    const earlier = userTexts.slice(0, -1);
    if (/favourite colour is/i.test(last)) return "Noted: your favourite colour is teal.";
    if (earlier.some((t) => /teal/i.test(t))) return "Your favourite colour is teal.";
    return "I have no record of your favourite colour.";
  };

  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
  const finishReason = { unified: "stop" as const, raw: undefined };

  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "memory-probe",
    supportedUrls: {},
    async doGenerate(options) {
      return { content: [{ type: "text", text: reply(options) }], finishReason, usage, warnings: [] };
    },
    async doStream(options) {
      const parts: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: reply(options) },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason, usage },
      ];
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
}
