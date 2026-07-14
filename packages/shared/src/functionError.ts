// supabase-js hardcodes FunctionsHttpError's `.message` to the generic
// "Edge Function returned a non-2xx status code" regardless of what the
// function actually returned — the real `{ error: "..." }` body only lives
// on `error.context` (the raw Response). Every edge-function call site in
// both apps should go through this instead of reading `error.message`
// directly, or the user only ever sees the generic string.
export async function getFunctionErrorMessage(error: unknown, fallback = "Something went wrong"): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body && typeof body.error === "string") return body.error;
    } catch {
      // Body wasn't JSON, or couldn't be read — fall through to the generic message.
    }
  }
  return error instanceof Error ? error.message : fallback;
}
