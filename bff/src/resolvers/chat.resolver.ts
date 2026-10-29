import { randomUUID } from "node:crypto";

import { UseGuards } from "@nestjs/common";
import { Args, Mutation, Resolver } from "@nestjs/graphql";

import { AuthGuard } from "../auth/auth.guard";

// Fixed reply so the frontend can build the chat now. It will forward the
// message to the mcp-server (POST /chat) once the agent exists.
@Resolver()
export class ChatResolver {
  @Mutation()
  @UseGuards(AuthGuard)
  chat(@Args("conversationId") conversationId: string | null) {
    return {
      conversationId: conversationId ?? randomUUID(),
      reply: "El asistente todavía no está disponible. ¡Pronto podrás pedirle cartas y mazos!",
    };
  }
}
