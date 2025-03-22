import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@shared/schema";

// Create postgres connection
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not defined in environment variables");
}

// Configure postgres to not parse dates automatically, we'll handle it in Drizzle
const queryClient = postgres(connectionString, { 
  max: 10,
  prepare: false
});

// Create drizzle database instance
export const db = drizzle(queryClient, { schema });
export { schema };