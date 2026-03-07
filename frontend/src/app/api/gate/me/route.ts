import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const email = cookies().get("osf_gate_email")?.value || "";
  return NextResponse.json({ email: email.toLowerCase() });
}
