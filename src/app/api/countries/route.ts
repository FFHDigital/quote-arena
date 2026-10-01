import { connection } from "next/server";
import { countries } from "@/lib/queries";

export async function GET() {
  await connection();
  return Response.json(countries());
}
