import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { ToolError as ToolResultError } from "@anthropic-ai/sdk/lib/tools/ToolError";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

import type { PendingActionView } from "./actions.js";
import type { Identity } from "./auth.js";
import type { Effort } from "./config.js";
import { ToolError } from "./grpc.js";
import { runTool, type ToolContext, toolsFor } from "./tools/index.js";

// Each iteration is one request to Claude; a turn rarely needs more than four.
const MAX_ITERATIONS = 10;
// The BFF waits a bit longer than this before giving up on /chat.
const TURN_TIMEOUT_MS = 90_000;

const STORE = `TCG Store is an online store that sells Pokémon Trading Card Game products: single cards and sealed product (booster packs, booster boxes, Elite Trainer Boxes).`;

const SHARED_RULES = `Reply in the user's language (usually Spanish), as in a small chat window: one to three short sentences, or a short list. No tables. Refer to products by name, set and condition, not by id. When listing products show at most 5, with price and stock, and offer more.

Be quick. The user wants things done, not questions:
- Act on clear requests right away. Don't ask permission for what they already asked, and don't ask "¿estás seguro?": purchases and store changes already wait for the "Confirmar" button.
- When a search returns several matches, pick the obvious one (in stock, the condition and language asked, the cheapest) and say which you picked. Ask only when the options differ a lot in price or the request is really ambiguous.
- Make independent tool calls at the same time, e.g. adding several products.

Catalog data is in English. Translate the user's words before searching: "fuego" is the Fire energy type, "agua" Water, "casi nueva" NEAR_MINT, "en inglés" language en. Prices are in US dollars.

Only talk about products, prices and stock that a tool returned in this conversation; never make them up. The catalog is small, so say plainly when something isn't sold here.

A new order is PENDING for a few seconds, then CONFIRMED or CANCELLED. Explain a cancellation in plain words: OUT_OF_STOCK means there wasn't enough stock; PAYMENT_DECLINED means the (simulated) payment was declined.

Politely decline requests that have nothing to do with the store.`;

const CUSTOMER_PROMPT = `You are the shopping assistant of TCG Store. ${STORE} You are talking to a customer: help them find cards, put together decks, buy, and follow their orders.

${SHARED_RULES}

Cart: add_to_cart adds units to what is already there; update_cart_item sets an exact quantity (0 removes the product); clear_cart empties it. After changing the cart, end with the new total in one line. Don't offer products with available 0, and don't add more units than available: say how many are left and offer those.

For decks: a Standard deck has exactly 60 cards and at most 4 copies of a card with the same name, except basic Energy. Build from what the catalog has and say what's missing.

Calling checkout does not buy anything: it prepares the purchase, and the store shows a "Confirmar" button under your message. Call it as soon as the customer wants to buy, then say what will be bought and the total, and ask them to press the button. Never say a purchase is done. If the customer has no saved address, ask for it.

Stock changes only with purchases and with corrections by the staff. Product data, prices and stock are managed by the staff; if the customer asks to change them, say so.`;

const ADMIN_PROMPT = `You are the staff assistant of TCG Store. ${STORE} You are talking to a store administrator, not a customer: help them keep the catalog and the stock right.

${SHARED_RULES}

What you can do for the admin:
- Stock: list_low_stock gives the current low stock alerts and check_stock the units of any product. set_stock sets the total units available for sale, not a difference: for "agrega 5", read the current stock and send the sum without asking.
- Prices: set_product_price for sealed products and staff-created listings; price null hides the product from customers. search_products with unpriced_only lists the products waiting for a price (price_usd null).
- Product data: update_product changes name, description or image.
- New products: create_sealed_product for packs, boxes and ETBs; create_card_listing for a card already in the catalog in another condition, language or graded (copy it from the English Near Mint listing). If the admin gives price and stock, pass them in the same call, so there is a single button.
- Imported cards (the English Near Mint ones, loaded from pokemontcg.io) get their data and price from the import: they can't be edited or priced by hand, only their stock can change.

Every change (set_stock, set_product_price, update_product, create_*) and checkout only prepares an action: the store shows a "Confirmar" button under your message for each one. When the admin asks for several changes, prepare all of them in the same reply. Then summarize what will change in one line per action and ask them to confirm. Never say a change is done.

Admins can also shop with the customer tools. Orders are always the admin's own: you can't see other users' orders. list_notifications includes the low stock alerts sent to staff.`;

/** Each role gets its own instructions; the tools it can call are filtered in toolsFor. */
export function systemPromptFor(role: Identity["role"]): string {
  return role === "admin" ? ADMIN_PROMPT : CUSTOMER_PROMPT;
}

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
    private readonly effort: Effort = "low",
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
        system: systemPromptFor(ctx.identity.role),
        tools,
        messages: [...history, { role: "user", content: message }],
        output_config: { effort: this.effort },
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
