import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel } from "./model.js";

// The AI's job stops here: turning fuzzy language into a *draft* of the
// same shape as RouteConstraints, but with place names left as free text.
// Coordinates are resolved afterwards by gazetteer.ts — deterministic code,
// not another model call. See PROJECT_SPEC.md §4.3 for why that split
// matters (the model is never trusted with geography, only intent).
export const draftConstraintsSchema = z.object({
  originQuery: z
    .string()
    .describe("The starting town/place name mentioned in the prompt, e.g. 'Ljubljana' or 'Rakitna'."),
  maxDurationMinutes: z.number().min(15).max(720),
  curvinessPref: z.enum(["relaxed", "twisty", "very_twisty"]),
  surfacePref: z.enum(["asphalt_only", "asphalt_preferred", "any"]),
  avoidHighways: z.boolean(),
  // .nullable(), not .optional(): OpenAI's strict structured-output mode
  // (hit via OpenRouter -> Azure in practice) requires every property to
  // appear in the schema's "required" array — an omittable key 400s with
  // "'required' is required... Missing 'mustPassNearQuery'". Modeling it as
  // nullable instead keeps the key present but lets the model say "none".
  mustPassNearQuery: z
    .string()
    .nullable()
    .describe("A single place the rider wants the loop to pass near or loop around, or null if none is mentioned."),
});

export type DraftConstraints = z.infer<typeof draftConstraintsSchema>;

const SYSTEM_PROMPT = `You are the intent-extraction step of a Slovenian motorcycle route planner. Convert a rider's natural-language request into structured ride constraints. Do not invent places outside Slovenia.

Slovenia-specific context:
- Regions: Gorenjska (Alps — Bled, Kranjska Gora, Vršič), Notranjska (karst — Rakitna, Postojna, Cerknica), Primorska (coast + Soča valley — Piran, Bovec, Tolmin), Dolenjska (Novo Mesto), Štajerska (Celje, Maribor), Koroška, Prekmurje.
- Famous twisty roads/passes: Vršič (extreme hairpins, closed in winter), Mangart (highest paved road in Slovenia), Pokljuka (forest plateau), Črni Kal (viaduct area near Koper).

Field guidance:
- originQuery: the rider's starting point. If none is mentioned, default to "Ljubljana".
- maxDurationMinutes: convert hours to minutes. If not stated, default to 90.
- curvinessPref: "relaxed"/"cruise"/"easy" -> relaxed. "twisty"/"curvy"/"windy roads" -> twisty. "hairpins"/"switchbacks"/"mountain pass"/"very twisty" -> very_twisty. Default to "twisty" if unspecified.
- surfacePref: default to "asphalt_preferred" unless the rider explicitly wants any surface (including gravel) or explicitly demands paved-only.
- avoidHighways: default to true — motorways add nothing to a scenic ride. Set false only if the rider explicitly asks for a fast or direct route.
- mustPassNearQuery: a single place the rider wants the loop to pass near (e.g. "a twisty route around Rakitna" -> "Rakitna"). Use null if no such place is mentioned.`;

export async function extractDraftConstraints(prompt: string): Promise<DraftConstraints> {
  const result = await generateText({
    model: getModel(),
    system: SYSTEM_PROMPT,
    prompt,
    output: Output.object({ schema: draftConstraintsSchema }),
  });
  return result.output;
}
