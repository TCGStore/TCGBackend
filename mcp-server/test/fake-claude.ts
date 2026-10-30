import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

interface Reply {
  content: object[];
  stop_reason: string;
}

export const text = (reply: string): Reply => ({ content: [{ type: "text", text: reply }], stop_reason: "end_turn" });

export const toolUse = (name: string, input: object = {}): Reply => ({
  content: [{ type: "tool_use", id: `toolu_${name}`, name, input }],
  stop_reason: "tool_use",
});

/** Stands in for the Claude API: answers each POST /v1/messages with the next scripted reply, or 500 when none is left. */
export async function startFakeClaude() {
  const requests: any[] = [];
  const replies: Reply[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
    }
    const body = JSON.parse(raw);
    requests.push(body);

    const reply = replies.shift();
    if (!reply) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "no scripted reply" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        ...reply,
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    replies,
    stop: () => server.close(),
  };
}
