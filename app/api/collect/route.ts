import { runCollection } from "@/lib/collector";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const slot = url.searchParams.get("slot") || "manual";
  const result = await runCollection(slot);
  return Response.json(result);
}
