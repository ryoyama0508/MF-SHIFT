import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, verifySessionTokenEdge } from "@/lib/auth-edge";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login" || pathname === "/api/auth") {
    if (pathname === "/login") {
      const password = process.env.APP_PASSWORD || "";
      const token = request.cookies.get(AUTH_COOKIE)?.value;
      if (password && (await verifySessionTokenEdge(token, password))) {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
    return NextResponse.next();
  }

  const password = process.env.APP_PASSWORD || "";
  if (!password) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (await verifySessionTokenEdge(token, password)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|clinic_logo.png).*)"],
};
