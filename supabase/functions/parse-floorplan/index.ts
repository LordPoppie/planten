// Leest een plattegrond (foto, scan of tekening) en stelt ruimtes voor.
import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod";
import { anthropicOptions, cors, json, readImage, requireUser } from "../_shared/common.ts";

const client = new Anthropic(anthropicOptions()); // ANTHROPIC_API_KEY (+ optioneel ANTHROPIC_WORKSPACE_ID) uit de function secrets

const Point = z.object({ x: z.number(), y: z.number() });
const Floorplan = z.object({
  is_floorplan: z.boolean(),
  north: z.enum(["top", "right", "bottom", "left", "unknown"]),
  rooms: z.array(z.object({
    name: z.string(),
    kind: z.enum([
      "woonkamer", "keuken", "slaapkamer", "badkamer", "toilet", "hal", "werkkamer",
      "kantoor", "vergaderruimte", "kantine", "receptie", "opslag", "overig",
    ]),
    polygon: z.array(Point),
    window_sides: z.array(z.enum(["top", "right", "bottom", "left"])),
  })),
});

const SYSTEM = `Je leest plattegronden (bouwtekening, Funda-plattegrond, scan of handschets) voor een plantenbeheer-app.
Geef elke afzonderlijke ruimte terug:
- name: de naam zoals op de tekening staat (Nederlands); verzin anders een logische naam ("Slaapkamer 2").
- polygon: de omtrek als punten, genormaliseerd: x en y tussen 0 en 1 t.o.v. de afbeelding (0,0 = linksboven). Een rechthoek = 4 punten.
- window_sides: aan welke zijde(n) van de ruimte ramen zitten, relatief aan de afbeelding. Leeg als er geen ramen te zien zijn.
- north: waar het noorden ligt als er een noordpijl staat, anders "unknown".
Sla trapgaten, schachten en maatvoering over. Is het geen plattegrond, zet is_floorplan op false en rooms leeg.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await requireUser(req))) return json({ error: "Niet ingelogd" }, 401);

  try {
    const { image, media_type } = await readImage(req);
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(Floorplan) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: image } },
          { type: "text", text: "Welke ruimtes staan op deze plattegrond?" },
        ],
      }],
    });

    if (response.stop_reason === "refusal") return json({ error: "Kon deze afbeelding niet beoordelen" }, 422);
    if (!response.parsed_output) return json({ error: "Geen bruikbaar antwoord" }, 502);
    return json(response.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Even te druk, probeer zo opnieuw" }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `AI-fout (${err.status})` }, 502);
    return json({ error: (err as Error).message }, 400);
  }
});
