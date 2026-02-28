import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email.endsWith("@osf.digital")) {
    return NextResponse.json({ ok: false, error: "Unauthorized domain." }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("osf_gate_ok", "true", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  response.cookies.set("osf_gate_email", email, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
