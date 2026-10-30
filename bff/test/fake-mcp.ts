import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Responses by action id, as the real mcp-server answers them.
const ACTIONS: Record<string, { status: number; body: object }> = {
  act_checkout: { status: 200, body: { kind: "checkout", result: { id: "ord_1", status: "PENDING" } } },
  act_stock: { status: 200, body: { kind: "set_stock", result: { product_id: "prd_etb", available: 3 } } },
  act_changed: { status: 409, body: { error: "the cart changed after the purchase was prepared: prepare it again" } },
};

// The agent prepares a purchase when asked to buy, and otherwise just answers.
function chatReply({ message, conversationId }: { message: string; conversationId?: string }) {
  const actions = message.includes("compra")
    ? [{ actionId: "act_checkout", kind: "checkout", summary: "Buy 1 product(s) for $149.99", details: {}, expiresAt: "2026-10-30T12:10:00.000Z" }]
    : [];
  return { conversationId: conversationId ?? "conv_new", reply: `Recibido: ${message}`, actions };
}

/** The mcp-server's /chat and /actions endpoints; every request is recorded in `requests`. */
export async function startFakeMcp() {
  const requests: { path: string; authorization?: string; body?: any }[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/chat") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
      }
      const body = JSON.parse(raw);
      requests.push({ path: req.url, authorization: req.headers.authorization, body });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(chatReply(body)));
      return;
    }

    requests.push({ path: req.url!, authorization: req.headers.authorization });
    const [, , actionId, verb] = req.url!.split("/");
    const action = ACTIONS[actionId!];
    const { status, body } =
      action && verb === "cancel"
        ? { status: 200, body: { cancelled: true } }
        : (action ?? { status: 404, body: { error: "pending action not found or expired" } });
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    stop: () => server.close(),
  };
}
