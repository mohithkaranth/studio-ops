import { parseDateMention } from "./date-parser";
import { extractSemanticQuery } from "./intent-extractor";
import { renderAnswer } from "./answer-renderer";
import { executeSemanticQuery } from "./result-shaper";
import { validateAndNormalizeSemanticQuery } from "./semantic-validator";

type ChatRequest = { question?: unknown };

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return Response.json({ type: "clarification", question: "What would you like to ask about Studio Ops data?" });
    }

    const parsedDate = parseDateMention(question);
    const rawQuery = await extractSemanticQuery(question);
    const validated = validateAndNormalizeSemanticQuery(rawQuery, question, parsedDate);

    if (validated.type === "clarification") return Response.json(validated);

    const shapedResult = await executeSemanticQuery(validated.query);
    const answer = renderAnswer(validated.query, shapedResult);
    return Response.json({ type: "answer", ...answer });
  } catch (error) {
    console.error("Studio Chat failed:", error);
    return Response.json({ error: "Studio Chat could not answer that question." }, { status: 500 });
  }
}
