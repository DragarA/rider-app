import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, users, sessions, accounts, verifications } from "@riding-app/db";

// Reuses the app's own `users` table as Better Auth's user table (see the
// comment above `users` in packages/db/src/schema.ts) instead of letting
// Better Auth create a parallel one — `usePlural: true` because every table
// here is already named the plural way this repo uses throughout
// (routes/pois/places, not route/poi/place). The only column that doesn't
// already match Better Auth's expected name is `name`, which this app calls
// `displayName`; session/account/verification match Better Auth's defaults
// exactly, so those need no field mapping.
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema: { users, sessions, accounts, verifications },
  }),
  advanced: {
    // Every id column here is `uuid().defaultRandom()` — let Postgres
    // generate them instead of Better Auth generating its own, so ids stay
    // consistent with the rest of the schema (routes/pois/places etc).
    database: { generateId: false },
  },
  user: {
    fields: { name: "displayName" },
  },
  emailAndPassword: {
    enabled: true,
  },
  basePath: "/api/v1/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.API_PORT ?? 8787}`,
  trustedOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:5173"],
});

export type AuthUser = typeof auth.$Infer.Session.user;
