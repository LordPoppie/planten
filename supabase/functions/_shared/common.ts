import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

/** Controleert het JWT van de ingelogde gebruiker; geeft user-id of null. */
export async function requireUser(req: Request): Promise<string | null> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

/** Leest { image: base64, media_type } en valideert grootte/type. */
export async function readImage(req: Request) {
  const { image, media_type } = await req.json();
  const types = ["image/jpeg", "image/png", "image/webp"] as const;
  if (typeof image !== "string" || !types.includes(media_type)) {
    throw new Error("Verwacht { image: base64, media_type: image/jpeg|png|webp }");
  }
  if (image.length > 6_000_000) throw new Error("Afbeelding te groot (max ~4 MB)");
  return { image, media_type: media_type as (typeof types)[number] };
}

/** Opties voor de Anthropic-client; stuurt het workspace-ID mee als de sleutel niet workspace-gebonden is. */
export function anthropicOptions() {
  const workspace = Deno.env.get("ANTHROPIC_WORKSPACE_ID");
  return workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {};
}
