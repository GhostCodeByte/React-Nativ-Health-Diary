# Supabase-Setup für OwnDiary

Kurzüberblick:
- Diese App kann wahlweise Supabase, eine eigene REST-API oder nur lokales SQLite nutzen.
- Mit gesetzten Supabase-Umgebungsvariablen (EXPO_PUBLIC_SUPABASE_*) nutzt die App bevorzugt Supabase.
- Ohne Supabase fällt die App auf REST (falls in den Einstellungen eine URL gesetzt ist) oder nur SQLite zurück.

## 1) Tabellen und RLS-Policies in Supabase anlegen

Führe die folgenden SQL-Befehle in der Supabase SQL-Konsole aus (Schema: public). Sie erstellen die benötigten Tabellen und aktivieren einfache, anonyme Lese-/Schreibrechte für den Minimalbetrieb ohne Benutzerverwaltung. Du kannst Policies später strenger konfigurieren.

~~~
-- Groups meta
create table if not exists public.groups (
  id          bigint generated always as identity primary key,
  name        text not null,
  "order"     int default 0,
  description text,
  icon        text
);

-- Questions meta
create table if not exists public.questions (
  id           bigint generated always as identity primary key,
  group_id     bigint references public.groups(id) on delete set null,
  question     text not null,
  answer_type  text not null check (answer_type in ('boolean','number','scale','text','multi')),
  min          double precision,
  max          double precision,
  step         double precision,
  options      jsonb,          -- array of strings für 'multi'
  placeholder  text,
  unit         text,
  "order"      int default 0,
  active       boolean default true
);

-- Diary entries (answers)
create table if not exists public.diary_entries (
  id           bigint generated always as identity primary key,
  question_id  bigint not null references public.questions(id) on delete cascade,
  date         date   not null,  -- YYYY-MM-DD
  time         text   not null,  -- "HH:mm"
  value        jsonb  not null,  -- boolean | number | string | string[]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_diary_entries_question_date
  on public.diary_entries (question_id, date);

-- RLS + Policies (Minimalbetrieb ohne Auth)
alter table public.groups enable row level security;
alter table public.questions enable row level security;
alter table public.diary_entries enable row level security;

create policy if not exists "groups_select_all"
  on public.groups for select using (true);

create policy if not exists "questions_select_all"
  on public.questions for select using (true);

create policy if not exists "diary_entries_insert_anyone"
  on public.diary_entries for insert with check (true);

-- Optional: Lesen von Einträgen erlauben (nicht empfohlen ohne Auth)
-- create policy if not exists "diary_entries_select_all"
--   on public.diary_entries for select using (true);
~~~

Benötigte Tabellen:
- public.groups
- public.questions
- public.diary_entries

## 2) Pakete installieren

- supabase-js Client:
  - npm: `npm i @supabase/supabase-js`
  - oder yarn: `yarn add @supabase/supabase-js`

Optional (falls erforderlich in deiner RN/Expo-Umgebung):
- URL-Polyfill: `npm i react-native-url-polyfill` und am App-Entry einmalig importieren: `import 'react-native-url-polyfill/auto'`

## 3) Umgebungsvariablen setzen (.env)

Lege in der Projektwurzel eine `.env` an (nur Public/Anon Key verwenden!):

- EXPO_PUBLIC_SUPABASE_URL=https://DEIN-PROJEKT-REF.supabase.co
- EXPO_PUBLIC_SUPABASE_ANON_KEY=DEIN_ANON_PUBLIC_KEY
- EXPO_PUBLIC_SUPABASE_SCHEMA=public (optional)
- EXPO_PUBLIC_SUPABASE_ENABLE_REALTIME=true (optional)

Hinweise:
- In Expo müssen Variablen mit EXPO_PUBLIC_ beginnen, damit sie im Client verfügbar sind.
- Nach Änderungen an .env den Dev-Server neu starten.

## 4) Wie die App entscheidet, welche Backend-Quelle genutzt wird

Priorität:
1) Supabase (falls EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY vorhanden)
2) Eigene REST-API (falls in den App-Einstellungen eine Basis-URL hinterlegt ist)
3) Lokales SQLite (Fallback)

Gespeicherte Antworten werden, wenn möglich, remote geschrieben; ansonsten lokal.

## 5) Minimal-Seed (Beispiel)

Lege ein paar Gruppen/Fragen an, damit der Focus Mode sofort Inhalte hat:

~~~
insert into public.groups (name, "order") values
  ('Allgemein', 1);

insert into public.questions (group_id, question, answer_type, "order", active)
values
  (null, 'Hast du heute ausreichend Wasser getrunken?', 'boolean', 1, true),
  (null, 'Wie viele Minuten warst du heute aktiv?', 'number', 2, true),
  (null, 'Wie fühlst du dich gerade?', 'text', 3, true);
~~~

Fertig. Starte die App neu. Wenn die Env-Variablen korrekt gesetzt sind, lädt die App die Fragen aus Supabase und schreibt Einträge in `public.diary_entries`.