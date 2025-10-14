/**
 * Supabase client factory and API methods (Expo + TypeScript)
 *
 * Mirrors the existing REST layer shape:
 *  - supaGetGroups(): Group[]
 *  - supaGetQuestions(): Question[]
 *  - supaInsertDiaryEntry(entry): void
 *  - supaInsertDiaryEntriesBulk(entries): void
 *  - supaPing(): boolean
 *
 * Environment:
 *  - EXPO_PUBLIC_SUPABASE_URL
 *  - EXPO_PUBLIC_SUPABASE_ANON_KEY
 *  - EXPO_PUBLIC_SUPABASE_SCHEMA (optional, defaults to "public")
 *
 * Packages to install:
 *  - @supabase/supabase-js
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DiaryEntry, Group, Question } from "../types";

/**
 * Recommended Supabase schema for this app (no users/auth for now).
 * Create these tables in Supabase SQL Editor or via migration.
 *
 * Notes:
 * - Using snake_case for Postgres columns; code maps camelCase <-> snake_case where needed.
 * - "order" is a reserved keyword in SQL; as a column name it's fine without quotes in Postgres.
 * - For simplicity, RLS policies allow public SELECT on metadata and public INSERT on entries.
 */
export const SUGGESTED_SCHEMA_SQL = `
-- SCHEMA: public (default)

-- Groups meta
create table if not exists public.groups (
  id          bigint generated always as identity primary key,
  name        text not null,
  "order"     int default 0,
  description text
);

-- Questions meta
create table if not exists public.questions (
  id           bigint generated always as identity primary key,
  group_id     bigint references public.groups(id) on delete set null,
  question     text not null,
  answer_type  text not null,
  min          double precision,
  max          double precision,
  step         double precision,
  options      jsonb,          -- array of strings for 'multi'
  placeholder  text,
  unit         text,
  "order"      int default 0,
  active       boolean default true,
  time_of_day  text not null default 'both' check (time_of_day in ('morning','evening','both')),
  ask_once_per_day boolean not null default false,
  ref_day text not null default 'today' check (ref_day in ('today','yesterday'))
);

-- Diary entries (answers)
create table if not exists public.diary_entries (
  id           bigint generated always as identity primary key,
  question_id  bigint not null references public.questions(id) on delete cascade,
  date         date   not null,  -- YYYY-MM-DD
  time         text   not null,  -- "HH:mm"
  value        jsonb  not null,  -- boolean | number | string | string[]
  for_day      text   not null default 'today' check (for_day in ('today','yesterday')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Helpful index for lookups
create index if not exists idx_diary_entries_question_date
  on public.diary_entries (question_id, date);

-- Enable RLS and permissive policies for simple anonymous usage (no users for now)
alter table public.groups enable row level security;
alter table public.questions enable row level security;
alter table public.diary_entries enable row level security;

-- Groups: allow anyone to read
create policy if not exists "groups_select_all"
  on public.groups
  for select
  using (true);

-- Questions: allow anyone to read
create policy if not exists "questions_select_all"
  on public.questions
  for select
  using (true);

-- Diary entries: allow anyone to insert (no read/update/delete by default)
create policy if not exists "diary_entries_insert_anyone"
  on public.diary_entries
  for insert
  with check (true);

-- Optional: if you want to allow reading entries as well (not recommended without auth)
-- create policy if not exists "diary_entries_select_all"
--   on public.diary_entries
--   for select
--   using (true);
`.trim();

/**
 * Minimal policy overview you can paste into Supabase if you already created tables:
 */
export const SUGGESTED_POLICIES_SQL = `
alter table public.groups enable row level security;
alter table public.questions enable row level security;
alter table public.diary_entries enable row level security;

create policy if not exists "groups_select_all" on public.groups for select using (true);
create policy if not exists "questions_select_all" on public.questions for select using (true);
create policy if not exists "diary_entries_insert_anyone" on public.diary_entries for insert with check (true);
`.trim();

/**
 * Utility: read and validate required environment variables.
 */
function readEnv() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const schema = (process.env.EXPO_PUBLIC_SUPABASE_SCHEMA || "public").trim();

  if (!url) {
    throw new Error(
      "Missing EXPO_PUBLIC_SUPABASE_URL. Set it in your .env file (e.g., https://YOUR-REF.supabase.co).",
    );
  }
  if (!anon) {
    throw new Error(
      "Missing EXPO_PUBLIC_SUPABASE_ANON_KEY. Set it in your .env file (public anon key from Supabase).",
    );
  }
  return { url, anon, schema };
}

/**
 * Singleton Supabase client for the app.
 */
let _supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_supabase) return _supabase;
  const { url, anon } = readEnv();
  _supabase = createClient(url, anon, {
    // You can tune global options here if needed
    auth: {
      persistSession: false, // no user/auth for now
      autoRefreshToken: false,
    },
    global: {
      // Optional: set schema if not "public"
      // fetch: (url, options) => fetch(url, options), // RN fetch is fine
    },
  });
  return _supabase;
}

/**
 * Returns true if environment appears configured for Supabase.
 * Useful for feature-toggling without throwing.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.EXPO_PUBLIC_SUPABASE_URL &&
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Lightweight ping: try to read 1 group, or fallback to a trivial RPC-less check.
 */
export async function supaPing(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("groups").select("id").limit(1);
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch groups from Supabase.
 * Sort by "order" ascending (nulls first).
 */
export async function supaGetGroups(): Promise<Group[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, description, order")
    .order("order", { ascending: true, nullsFirst: true });

  if (error) throw wrapSupabaseError("groups select", error);

  const groups = (data || []).map(toGroup);
  // Guarantee stable sort by order then id, in case nulls-first varies by backend
  return groups.sort(
    (a: Group, b: Group) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id,
  );
}

/**
 * Fetch questions from Supabase.
 * Returns active questions ordered by "order" then id.
 */
export async function supaGetQuestions(): Promise<Question[]> {
  const supabase = getSupabaseClient();

  // Filter active OR null (treated as active) to match local fallback behavior.
  const { data, error } = await supabase
    .from("questions")
    .select(
      [
        "id",
        "group_id",
        "question",
        "answer_type",
        "min",
        "max",
        "step",
        "options",
        "placeholder",
        "unit",
        "order",
        "active",
        "time_of_day",
        "ask_once_per_day",
        "ref_day",
      ].join(", "),
    )
    .or("active.is.null,active.eq.true")
    .order("order", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true });

  if (error) throw wrapSupabaseError("questions select", error);

  const items = (data || [])
    .map(toQuestion)
    .filter((q: Question | null): q is Question => !!q);
  return items as Question[];
}

/**
 * Insert a single diary entry.
 * The backend will assign its own id; we ignore the returned id here.
 */
export async function supaInsertDiaryEntry(entry: DiaryEntry): Promise<void> {
  const supabase = getSupabaseClient();

  const payload = toDiaryEntryInsert(entry);
  const { error } = await supabase.from("diary_entries").insert(payload);

  if (error) throw wrapSupabaseError("diary_entries insert", error);
}

/**
 * Insert multiple diary entries in a single request.
 */
export async function supaInsertDiaryEntriesBulk(
  entries: DiaryEntry[],
): Promise<void> {
  if (!entries.length) return;

  const supabase = getSupabaseClient();
  const payload = entries.map(toDiaryEntryInsert);
  const { error } = await supabase.from("diary_entries").insert(payload);

  if (error) throw wrapSupabaseError("diary_entries bulk insert", error);
}

/**
 * Mapping helpers
 */

function toGroup(row: any): Group {
  return {
    id: numberish(row.id),
    name: String(row.name ?? ""),
    order:
      typeof row.order === "number" ? row.order : numberish(row.order ?? 0),
    description:
      row.description === null || row.description === undefined
        ? null
        : String(row.description),
  };
}

function toQuestion(row: any): Question | null {
  if (!row || typeof row.id === "undefined" || row.id === null) return null;

  const options = Array.isArray(row.options)
    ? row.options.map(String)
    : isJsonArray(row.options)
      ? (tryParseJson(row.options) as string[]).map(String)
      : undefined;

  return {
    id: numberish(row.id),
    groupId:
      row.group_id === null || row.group_id === undefined
        ? null
        : numberish(row.group_id),
    question: String(row.question ?? ""),
    answerType: String(row.answer_type ?? "") as Question["answerType"],
    min:
      row.min === null || row.min === undefined ? undefined : Number(row.min),
    max:
      row.max === null || row.max === undefined ? undefined : Number(row.max),
    step:
      row.step === null || row.step === undefined
        ? undefined
        : Number(row.step),
    options,
    placeholder:
      row.placeholder === null || row.placeholder === undefined
        ? undefined
        : String(row.placeholder),
    unit:
      row.unit === null || row.unit === undefined
        ? undefined
        : String(row.unit),
    order:
      row.order === null || row.order === undefined
        ? undefined
        : numberish(row.order),
    active:
      row.active === null || row.active === undefined
        ? undefined
        : Boolean(row.active),
    askOncePerDay:
      row.ask_once_per_day === null || row.ask_once_per_day === undefined
        ? undefined
        : Boolean(row.ask_once_per_day),
    timeOfDay: String(row.time_of_day ?? "both") as Question["timeOfDay"],
    refDay: String(row.ref_day ?? "today") as Question["refDay"],
  };
}

function toDiaryEntryInsert(entry: DiaryEntry): Record<string, any> {
  // We rely on DB defaults for created_at/updated_at.
  return {
    question_id: entry.questionID,
    date: entry.date, // should be YYYY-MM-DD
    time: entry.time, // HH:mm
    value: entry.value, // Supabase will store as jsonb
    for_day: String(entry.forDay ?? "today"),
  };
}

/**
 * Error normalization for clearer messages in UI.
 */
function wrapSupabaseError(ctx: string, err: any): Error {
  const code = err?.code ? ` [${err.code}]` : "";
  const details =
    typeof err?.message === "string"
      ? err.message
      : typeof err?.error_description === "string"
        ? err.error_description
        : JSON.stringify(err);
  return new Error(`[Supabase] ${ctx} failed${code}: ${details}`);
}

/**
 * Safe helpers
 */
function numberish(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isJsonArray(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.startsWith("[") && t.endsWith("]");
}

function tryParseJson(v: string): any {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/**
 * CRUD helpers: Groups
 */

/**
 * Insert a new group and return the created row.
 */
export async function supaInsertGroup(
  input: Omit<Group, "id">,
): Promise<Group> {
  const supabase = getSupabaseClient();
  const payload = {
    name: input.name,
    description:
      input.description === null || input.description === undefined
        ? null
        : String(input.description),

    order:
      typeof input.order === "number" ? input.order : numberish(input.order),
  };

  const { data, error } = await supabase
    .from("groups")
    .insert(payload)
    .select("id, name, description, order")
    .single();

  if (error) throw wrapSupabaseError("groups insert", error);
  return toGroup(data);
}

/**
 * Update an existing group by id and return the updated row.
 */
export async function supaUpdateGroup(
  id: number,
  changes: Partial<Omit<Group, "id">>,
): Promise<Group> {
  const supabase = getSupabaseClient();
  const payload: Record<string, any> = {};
  if (Object.prototype.hasOwnProperty.call(changes, "name"))
    payload.name = changes.name;
  if (Object.prototype.hasOwnProperty.call(changes, "description"))
    payload.description =
      changes.description === null || changes.description === undefined
        ? null
        : String(changes.description);

  if (Object.prototype.hasOwnProperty.call(changes, "order"))
    payload.order =
      typeof changes.order === "number"
        ? changes.order
        : changes.order === undefined
          ? null
          : numberish(changes.order);

  const { data, error } = await supabase
    .from("groups")
    .update(payload)
    .eq("id", id)
    .select("id, name, description, order")
    .single();

  if (error) throw wrapSupabaseError("groups update", error);
  return toGroup(data);
}

/**
 * Delete a group by id.
 * Note: Depending on your DB constraints, deleting a group might affect related questions.
 */
export async function supaDeleteGroup(id: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("groups").delete().eq("id", id);
  if (error) throw wrapSupabaseError("groups delete", error);
}

/**
 * CRUD helpers: Questions
 */

/**
 * Insert a new question and return the created row.
 */
export async function supaInsertQuestion(
  input: Omit<Question, "id">,
): Promise<Question> {
  const supabase = getSupabaseClient();
  const payload = {
    group_id:
      input.groupId === null || input.groupId === undefined
        ? null
        : numberish(input.groupId),
    question: String(input.question ?? ""),
    answer_type: String(input.answerType),
    min:
      input.min === null || input.min === undefined ? null : Number(input.min),
    max:
      input.max === null || input.max === undefined ? null : Number(input.max),
    step:
      input.step === null || input.step === undefined
        ? null
        : Number(input.step),
    options:
      input.options === undefined
        ? null
        : Array.isArray(input.options)
          ? input.options.map(String)
          : null,
    placeholder:
      input.placeholder === null || input.placeholder === undefined
        ? null
        : String(input.placeholder),
    unit:
      input.unit === null || input.unit === undefined
        ? null
        : String(input.unit),
    order:
      input.order === null || input.order === undefined
        ? 0
        : numberish(input.order),
    active:
      input.active === null || input.active === undefined
        ? true
        : Boolean(input.active),
    time_of_day: String(input.timeOfDay ?? "both"),
    ask_once_per_day:
      input.askOncePerDay === null || input.askOncePerDay === undefined
        ? false
        : Boolean(input.askOncePerDay),
    ref_day: String(input.refDay ?? "today"),
  };

  const { data, error } = await supabase
    .from("questions")
    .insert(payload)
    .select(
      [
        "id",
        "group_id",
        "question",
        "answer_type",
        "min",
        "max",
        "step",
        "options",
        "placeholder",
        "unit",
        "order",
        "active",
        "time_of_day",
        "ask_once_per_day",
        "ref_day",
      ].join(", "),
    )
    .single();

  if (error) throw wrapSupabaseError("questions insert", error);
  const q = toQuestion(data);
  if (!q) throw new Error("Inserted question did not return a valid row.");
  return q;
}

/**
 * Update an existing question by id and return the updated row.
 */
export async function supaUpdateQuestion(
  id: number,
  changes: Partial<Omit<Question, "id">>,
): Promise<Question> {
  const supabase = getSupabaseClient();
  const payload: Record<string, any> = {};

  if (Object.prototype.hasOwnProperty.call(changes, "groupId"))
    payload.group_id =
      changes.groupId === null || changes.groupId === undefined
        ? null
        : numberish(changes.groupId);
  if (Object.prototype.hasOwnProperty.call(changes, "question"))
    payload.question =
      changes.question === undefined ? undefined : String(changes.question);
  if (Object.prototype.hasOwnProperty.call(changes, "answerType"))
    payload.answer_type =
      changes.answerType === undefined ? undefined : String(changes.answerType);
  if (Object.prototype.hasOwnProperty.call(changes, "min"))
    payload.min =
      changes.min === null || changes.min === undefined
        ? null
        : Number(changes.min);
  if (Object.prototype.hasOwnProperty.call(changes, "max"))
    payload.max =
      changes.max === null || changes.max === undefined
        ? null
        : Number(changes.max);
  if (Object.prototype.hasOwnProperty.call(changes, "step"))
    payload.step =
      changes.step === null || changes.step === undefined
        ? null
        : Number(changes.step);
  if (Object.prototype.hasOwnProperty.call(changes, "options"))
    payload.options =
      changes.options === undefined
        ? undefined
        : changes.options === null
          ? null
          : Array.isArray(changes.options)
            ? changes.options.map(String)
            : null;
  if (Object.prototype.hasOwnProperty.call(changes, "placeholder"))
    payload.placeholder =
      changes.placeholder === null || changes.placeholder === undefined
        ? null
        : String(changes.placeholder);
  if (Object.prototype.hasOwnProperty.call(changes, "unit"))
    payload.unit =
      changes.unit === null || changes.unit === undefined
        ? null
        : String(changes.unit);
  if (Object.prototype.hasOwnProperty.call(changes, "order"))
    payload.order =
      changes.order === null || changes.order === undefined
        ? null
        : numberish(changes.order);
  if (Object.prototype.hasOwnProperty.call(changes, "active"))
    payload.active =
      changes.active === null || changes.active === undefined
        ? null
        : Boolean(changes.active);
  if (Object.prototype.hasOwnProperty.call(changes, "timeOfDay"))
    payload.time_of_day =
      changes.timeOfDay === undefined ? undefined : String(changes.timeOfDay);
  if (Object.prototype.hasOwnProperty.call(changes, "refDay"))
    payload.ref_day =
      changes.refDay === undefined ? undefined : String(changes.refDay);
  if (Object.prototype.hasOwnProperty.call(changes, "askOncePerDay"))
    payload.ask_once_per_day =
      changes.askOncePerDay === null || changes.askOncePerDay === undefined
        ? null
        : Boolean(changes.askOncePerDay);
  if (Object.prototype.hasOwnProperty.call(changes, "askOncePerDay"))
    payload.ask_once_per_day =
      changes.askOncePerDay === null || changes.askOncePerDay === undefined
        ? null
        : Boolean(changes.askOncePerDay);

  const { data, error } = await supabase
    .from("questions")
    .update(payload)
    .eq("id", id)
    .select(
      [
        "id",
        "group_id",
        "question",
        "answer_type",
        "min",
        "max",
        "step",
        "options",
        "placeholder",
        "unit",
        "order",
        "active",
        "time_of_day",
        "ask_once_per_day",
        "ref_day",
      ].join(", "),
    )
    .single();

  if (error) throw wrapSupabaseError("questions update", error);
  const q = toQuestion(data);
  if (!q) throw new Error("Updated question did not return a valid row.");
  return q;
}

/**
 * Delete a question by id.
 */
export async function supaDeleteQuestion(id: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("questions").delete().eq("id", id);
  if (error) throw wrapSupabaseError("questions delete", error);
}

/**
 * Fetch diary entries for a specific ISO date (YYYY-MM-DD)
 * Ordered by time (ascending), then id.
 */
export async function supaGetDiaryEntriesByDate(
  date: string,
): Promise<DiaryEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("diary_entries")
    .select(
      "id, question_id, date, time, value, created_at, updated_at, for_day",
    )
    .eq("date", date)
    .order("time", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw wrapSupabaseError("diary_entries by date", error);

  const items = (data || []).map(
    (row: any): DiaryEntry => ({
      id: Number(row.id) || 0,
      questionID: Number(row.question_id),
      date: String(row.date),
      time: String(row.time),
      value: row.value,
      createdAt: row.created_at ?? undefined,
      updatedAt: row.updated_at ?? undefined,
      forDay: (row.for_day ?? "today") as "today" | "yesterday",
    }),
  );
  return items;
}

/**
 * Fetch diary entries in an inclusive date range (YYYY-MM-DD .. YYYY-MM-DD)
 * Ordered by date, time, then id.
 */
export async function supaGetDiaryEntriesInRange(
  startDate: string,
  endDate: string,
): Promise<DiaryEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("diary_entries")
    .select(
      "id, question_id, date, time, value, created_at, updated_at, for_day",
    )
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true })
    .order("time", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw wrapSupabaseError("diary_entries in range", error);

  const items = (data || []).map(
    (row: any): DiaryEntry => ({
      id: Number(row.id) || 0,
      questionID: Number(row.question_id),
      date: String(row.date),
      time: String(row.time),
      value: row.value,
      createdAt: row.created_at ?? undefined,
      updatedAt: row.updated_at ?? undefined,
      forDay: (row.for_day ?? "today") as "today" | "yesterday",
    }),
  );
  return items;
}

/**
 * Check if a question has already been answered for a given date (and ref day).
 * Returns true if at least one entry exists for (question_id, date, for_day).
 */
export async function supaHasAnsweredQuestionOnDate(
  questionId: number,
  date: string,
  forDay: "today" | "yesterday" = "today",
): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("diary_entries")
    .select("id")
    .eq("question_id", questionId)
    .eq("date", date)
    .limit(1);

  if (error) throw wrapSupabaseError("diary_entries exists by date", error);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Upsert-like helper: set a diary entry for (questionID, date)
 * Strategy without unique constraint:
 *  - Delete existing entries for (question_id, date)
 *  - Insert the new entry
 */
export async function supaSetDiaryEntry(entry: DiaryEntry): Promise<void> {
  const supabase = getSupabaseClient();

  // Remove any existing entries for this question and date
  const { error: delErr } = await supabase
    .from("diary_entries")
    .delete()
    .eq("question_id", entry.questionID)
    .eq("date", entry.date)
    .eq("for_day", String(entry.forDay ?? "today"));

  if (delErr) throw wrapSupabaseError("diary_entries delete (set)", delErr);

  // Insert fresh value
  const payload = toDiaryEntryInsert(entry);
  const { error: insErr } = await supabase
    .from("diary_entries")
    .insert(payload);
  if (insErr) throw wrapSupabaseError("diary_entries insert (set)", insErr);
}

/**
 * Optional usage examples:
 *
 * import {
 *   supaGetGroups,
 *   supaGetQuestions,
 *   supaInsertDiaryEntry,
 *   supaInsertDiaryEntriesBulk,
 *   supaGetDiaryEntriesByDate,
 *   supaGetDiaryEntriesInRange,
 *   supaSetDiaryEntry,
 *   supaPing,
 *   isSupabaseConfigured,
 *   SUGGESTED_SCHEMA_SQL,
 *   // New CRUD helpers:
 *   supaInsertGroup,
 *   supaUpdateGroup,
 *   supaDeleteGroup,
 *   supaInsertQuestion,
 *   supaUpdateQuestion,
 *   supaDeleteQuestion,
 * } from "./supabase";
 *
 * if (isSupabaseConfigured()) {
 *   const ok = await supaPing();
 *   if (ok) {
 *     const group = await supaInsertGroup({ name: "Allgemein", order: 1, description: null, icon: null });
 *     const updated = await supaUpdateGroup(group.id, { name: "General" });
 *     const q = await supaInsertQuestion({
 *       groupId: updated.id,
 *       question: "Wie fühlst du dich?",
 *       answerType: "text",
 *       placeholder: "z. B. gut, müde…",
 *       order: 1,
 *       active: true,
 *     });
 *     await supaUpdateQuestion(q.id, { active: true, order: 2 });
 *     const groups = await supaGetGroups();
 *     const questions = await supaGetQuestions();
 *     await supaInsertDiaryEntry({ id:0, questionID: questions[0].id, date: "2025-01-31", time:"07:45", value: true });
 *
 *     // New helpers:
 *     const today = new Date().toISOString().slice(0,10);
 *     const todaysEntries = await supaGetDiaryEntriesByDate(today);
 *     const rangeEntries = await supaGetDiaryEntriesInRange("2025-01-01","2025-01-31");
 *     await supaSetDiaryEntry({ id:0, questionID: questions[0].id, date: today, time: "08:00", value: "Hello" });
 *   }
 * }
 */
