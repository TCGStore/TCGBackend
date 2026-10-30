import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { ToolError as ToolResultError } from "@anthropic-ai/sdk/lib/tools/ToolError";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

import type { PendingActionView } from "./actions.js";
import { ToolError } from "./grpc.js";
import { runTool, type ToolContext, toolsFor } from "./tools/index.js";

// Each iteration is one request to Claude; a turn rarely needs more than four.
const MAX_ITERATIONS = 10;
// The BFF waits a bit longer than this before giving up on /chat.
const TURN_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = `You are the shopping assistant of TCG Store, an online store that sells Pokémon Trading Card Game products: single cards and sealed product (booster packs, booster boxes, Elite Trainer Boxes). You help customers find cards, put together decks, buy, and follow their orders.

Reply in the customer's language (usually Spanish), briefly, as in a small chat window: short paragraphs or simple lists, no tables. Refer to products by name, set and condition, not by id.

Catalog data is in English. Translate the customer's words before searching: "fuego" is the Fire energy type, "agua" Water, "casi nueva" NEAR_MINT, "en inglés" language en. Prices are in US dollars.

Only talk about products, prices and stock that a tool returned in this conversation; never make them up. The catalog is small, so say plainly when something isn't sold here. Don't offer products with available 0.

For decks: a Standard deck has exactly 60 cards and at most 4 copies of a card with the same name, except basic Energy. Build from what the catalog has and say what's missing.

Add products to the cart when the customer asks. Calling checkout or set_stock does not buy or change anything: it prepares an action, and the store shows the customer a "Confirmar" button under your message. After calling them, summarize what will happen and ask the customer to press the button. Never say a purchase or stock change is done.

A new order is PENDING for a few seconds, then CONFIRMED or CANCELLED. Explain a cancellation in plain words: OUT_OF_STOCK means there wasn't enough stock; PAYMENT_DECLINED means the (simulated) payment was declined.

Politely decline requests that have nothing to do with the store.`;

export interface AgentTurn {
  reply: string;
  /** Pending actions prepared in this turn; the frontend shows a "Confirmar" button for each. */
  actions: PendingActionView[];
  /** The conversation so far, to send with the next message. */
  messages: BetaMessageParam[];
}

export class Agent {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
  ) {}

  async reply(ctx: ToolContext, history: BetaMessageParam[], message: string): Promise<AgentTurn> {
    const actions: PendingActionView[] = [];
    const tools = toolsFor(ctx.identity).map((tool) =>
      betaTool({
        name: tool.name,
        description: tool.description,
        // The input side of the schema, as MCP lists it: fields with a default stay optional.
        inputSchema: z.toJSONSchema(tool.inputSchema, { io: "input" }) as { type: "object" },
        // runTool validates the input with zod.
        run: async (input) => {
          const outcome = await runTool(tool, input, ctx);
          if (!outcome.ok) {
            throw new ToolResultError(outcome.message);
          }
          if (tool.needsConfirmation) {
            actions.push(outcome.result as PendingActionView);
          }
          return JSON.stringify(outcome.result);
        },
      }),
    );

    const runner = this.client.beta.messages.toolRunner(
      {
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools,
        messages: [...history, { role: "user", content: message }],
        output_config: { effort: "medium" },
        // Caches the system prompt, the tools and the history, which every turn resends.
        cache_control: { type: "ephemeral" },
        // If the model declines for policy reasons, the API retries on a fallback model.
        fallbacks: "default",
        betas: ["server-side-fallback-2026-07-01"],
        max_iterations: MAX_ITERATIONS,
        thread: false,
      },
      { signal: AbortSignal.timeout(TURN_TIMEOUT_MS) },
    );

    let final;
    try {
      final = await runner.runUntilDone();
    } catch (error) {
      throw toClientError(error);
    }

    const text = final.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    return { reply: text || fallbackReply(final.stop_reason), actions, messages: [...runner.params.messages] };
  }
}

function fallbackReply(stopReason: string | null): string {
  return stopReason === "refusal"
    ? "No puedo ayudarte con eso. ¿Te ayudo a buscar cartas o a revisar tus pedidos?"
    : "No alcancé a terminar. ¿Puedes repetirlo o dar más detalles?";
}

// Problems on Claude's side become 503 so the BFF can tell the user to try again.
function toClientError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) {
    return new ToolError("the assistant took too long, try again", 503);
  }
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new ToolError("the assistant is unavailable, try again later", 503);
  }
  return error;
}
