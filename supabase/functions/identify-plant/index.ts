// Herkent een kamerplant op een foto en geeft een zorgprofiel terug.
import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod";
import { anthropicOptions, cors, json, readImage, requireUser } from "../_shared/common.ts";

const client = new Anthropic(anthropicOptions()); // ANTHROPIC_API_KEY (+ optioneel ANTHROPIC_WORKSPACE_ID) uit de function secrets

const PlantProfile = z.object({
  is_plant: z.boolean(),
  species: z.string(),
  common_name: z.string(),
  confidence: z.enum(["hoog", "middel", "laag"]),
  alternatives: z.array(z.object({ species: z.string(), common_name: z.string() })),
  base_interval_days: z.number(),
  water_amount_ml: z.number(),
  water_how: z.string(),
  dry_check: z.string(),
  light_need: z.enum(["low", "medium", "bright_indirect", "direct"]),
  toxic_pets: z.boolean(),
  fertilize_weeks: z.number(),
  tips: z.array(z.string()),
});

const SYSTEM = `Je bent een ervaren plantenkenner die kamer- en kantoorplanten herkent voor een Nederlandse plantenbeheer-app.
Geef alle tekst in het Nederlands. common_name is de gangbare Nederlandse naam (of de handelsnaam als er geen is).
Zorgwaarden gelden als referentie: pot van ~15 cm, plastic pot, middelmatig indirect licht, voorjaar, binnen in Nederland.
De app past zelf factoren toe voor licht, verwarming, seizoen en pot — reken die dus NIET in base_interval_days.
- base_interval_days: dagen tussen twee waterbeurten in die referentiesituatie (hele dagen).
- water_amount_ml: hoeveelheid per beurt voor die 15 cm-pot.
- water_how: één korte zin hoe water te geven (bv. "Giet tot het onderin uitloopt, schotel na 15 min legen").
- dry_check: één korte zin hoe je voelt of de plant water nodig heeft.
- fertilize_weeks: om de hoeveel weken voeden in het groeiseizoen; 0 als niet nodig.
- tips: maximaal 3 korte, concrete tips.
- alternatives: maximaal 2 andere soorten waar het op zou kunnen lijken (leeg als je zeker bent).
Staat er geen plant op de foto, zet is_plant op false en vul de rest met lege/0-waarden.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await requireUser(req))) return json({ error: "Niet ingelogd" }, 401);

  try {
    const { image, media_type } = await readImage(req);
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(PlantProfile) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: image } },
          { type: "text", text: "Welke plant is dit, en wat is het zorgprofiel?" },
        ],
      }],
    });

    if (response.stop_reason === "refusal") return json({ error: "Kon deze foto niet beoordelen" }, 422);
    if (!response.parsed_output) return json({ error: "Geen bruikbaar antwoord" }, 502);
    return json(response.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Even te druk, probeer zo opnieuw" }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `AI-fout (${err.status})` }, 502);
    return json({ error: (err as Error).message }, 400);
  }
});
