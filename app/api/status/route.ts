import { aiConfigured } from "@/lib/ai";
export async function GET() { return Response.json({ aiConfigured: aiConfigured() }); }
