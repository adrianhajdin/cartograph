"use client";

import { useSession } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import type { Database } from "./database.types";

// Read literally so Next inlines them into the browser bundle; a lookup by
// variable name would be undefined here.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// The browser's client carries the Clerk session token, the same one the
// server sends, so the socket joins as the signed-in member and the
// realtime.messages policy decides which channels it may hear. Realtime asks
// for a fresh token on every heartbeat, so a 60-second token never lapses
// mid-run. Null until Clerk has a session.
export function useBrowserSupabase(): SupabaseClient<Database> | null {
  const { session } = useSession();
  return useMemo(() => {
    if (!session) return null;
    if (!URL || !KEY) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set");
    return createClient<Database>(URL, KEY, { accessToken: async () => (await session.getToken()) ?? null });
  }, [session]);
}
