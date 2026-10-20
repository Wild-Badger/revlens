import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./lib/db";
import { z } from "zod";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    ...(process.env.LOCAL_WORKSPACE_MODE !== "true" && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
      ? [GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET })]
      : []),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user?.password || !(await bcrypt.compare(parsed.data.password, user.password))) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
    ...(process.env.DEMO_MODE === "true" ? [Credentials({
      id: "demo",
      credentials: {},
      async authorize() {
        return { id: "portfolio-demo", name: "Demo workspace", email: null, role: "viewer" };
      },
    })] : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.role = user.role ?? "viewer"; token.id = user.id; }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = typeof token.role === "string" ? token.role : "viewer";
        session.user.id = typeof token.id === "string" ? token.id : "";
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
});
