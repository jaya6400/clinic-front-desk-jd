import { z } from "zod";
import { runConversation, toContractResponse } from "./engine";

const Body = z.object({
  conversation_id: z.string().min(1),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  turns: z.array(z.string()),
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/** Shared handler for POST /agent/run and its /api/public mirror. */
export async function handleAgentRun(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) return json({ error: "invalid request", issues: parsed.error.issues }, 400);
  const { conversation_id, today, turns } = parsed.data;
  // Fresh clinic state per call: runConversation builds its own Clinic.
  return json(toContractResponse(runConversation(conversation_id, today, turns)));
}
