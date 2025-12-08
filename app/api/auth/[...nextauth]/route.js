
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const handler = NextAuth({
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        }),
    ],
    secret: process.env.NEXTAUTH_SECRET,
    callbacks: {
        async signIn({ user, account, profile, email, credentials }) {
            // Security: Only allow YOUR specific email
            const allowedEmail = "ushikoshi.haruki@gmail.com"; // Replace with actual email or env var
            // Better to use an Environment Variable for flexibility, but hardcoding for now as verified user
            // We can also check if the email ends with a domain if needed.

            // Allow only if email matches
            return user.email === allowedEmail || user.email === process.env.ALLOWED_EMAIL;
        },
        async session({ session, token, user }) {
            return session;
        }
    }
});

export { handler as GET, handler as POST };
