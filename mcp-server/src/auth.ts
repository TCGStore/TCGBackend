import jwt from "jsonwebtoken";

/** Who is talking to the agent. Tools take it from here, never from the model's input. */
export interface Identity {
  userId: string;
  email: string;
  role: "customer" | "admin";
}

/** Verifies the JWT with the secret shared with users-service and the BFF; null if missing, invalid or expired. */
export function verifyBearer(header: string | undefined, secret: string): Identity | null {
  const token = header?.match(/^Bearer (.+)$/)?.[1];
  if (!token) {
    return null;
  }
  try {
    const { sub, email, role } = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (typeof sub !== "string" || typeof email !== "string" || (role !== "customer" && role !== "admin")) {
      return null;
    }
    return { userId: sub, email, role };
  } catch {
    return null;
  }
}
