
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
    function middleware(req) {
        // This function is only called if the user is authenticated.

        // 1. Get the request Headers
        const requestHeaders = new Headers(req.headers);

        // 2. Inject the Internal API Key for Backend communication
        // This header will be present when the request is forwarded by `rewrites` or `fetch` calls from Server Components.
        const internalKey = process.env.INTERNAL_API_KEY;
        if (internalKey) {
            requestHeaders.set("X-INTERNAL-API-KEY", internalKey);
        }

        // 3. Forward the request with the new headers
        return NextResponse.next({
            request: {
                headers: requestHeaders,
            },
        });
    },
    {
        callbacks: {
            authorized: ({ token }) => !!token, // Return true if logged in
        },
    }
);

// Protect all routes except public assets and auth routes
export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api/auth (auth routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - public folder content if any
         */
        "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
    ],
};
