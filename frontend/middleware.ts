import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }
  const allowed = request.cookies.get("osf_gate_ok")?.value === "true";
  if (allowed) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/gate", request.url));
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
