import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("osf_gate_ok", "", { maxAge: 0, path: "/" });
  response.cookies.set("osf_gate_email", "", { maxAge: 0, path: "/" });
  return response;
}
