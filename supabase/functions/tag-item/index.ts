// Suggests type, subtype, color and pattern for one clothing photo using Claude.
// Called from the app with the signed-in user's JWT (Supabase verifies it before this runs).
// Body: { image: <base64 JPEG/PNG/WebP>, media_type: "image/jpeg" }
// Secret: ANTHROPIC_API_KEY (supabase secrets set ANTHROPIC_API_KEY=...)
// Optional: CLAUDE_MODEL to override the model.

import Anthropic from "npm:@anthropic-ai/sdk";

const TYPES = ["top", "bottom", "dress", "innerwear", "outerwear", "shoes", "socks", "accessory"];
const COLORS = [
  "black", "white", "grey", "beige", "brown", "navy", "blue", "green",
  "olive", "yellow", "orange", "red", "pink", "purple", "gold", "silver", "multicolor",
];
const PATTERNS = [
  "solid", "striped", "checked", "floral", "polka dot", "animal print",
  "graphic", "geometric", "abstract", "textured", "other",
];
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

const SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: TYPES },
    subtype: { type: "string", description: "Short lowercase name, e.g. 'midi dress', 'ankle boots', 'cardigan'." },
    color: { type: "string", enum: COLORS, description: "The main color of the garment." },
    pattern: { type: "string", enum: PATTERNS },
  },
  required: ["type", "subtype", "color", "pattern"],
  additionalProperties: false,
};

const PROMPT =
  "This is a photo of one clothing item or accessory from someone's wardrobe, usually with the " +
  "background removed. Identify the item. Choose the closest type, a short subtype, its main color " +
  "and its pattern. If several items appear, describe the most prominent one.";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let image: string, mediaType: MediaType;
  try {
    const body = await req.json();
    image = body.image;
    mediaType = MEDIA_TYPES.includes(body.media_type) ? body.media_type : "image/jpeg";
    if (typeof image !== "string" || image.length < 100) throw new Error("missing image");
    if (image.length > 5_000_000) return json({ error: "Image too large" }, 413);
  } catch {
    return json({ error: "Expected JSON body { image, media_type }" }, 400);
  }

  try {
    const response = await client.beta.messages.create({
      model: Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5-5",
      max_tokens: 1024,
      // A quick visual classification: low effort keeps it fast and cheap.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") return json(null);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json(null);
    return json(JSON.parse(text.text));
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Busy, try again shortly" }, 429);
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error", err.status, err.message);
      return json({ error: "Tagging failed" }, 502);
    }
    console.error(err);
    return json({ error: "Tagging failed" }, 500);
  }
});
