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
  active       boolean default true,
  time_of_day  text not null default 'both' check (time_of_day in ('morning','evening','both')),
  ref_day      text not null default 'today' check (ref_day in ('today','yesterday'))
);

-- Diary entries (answers)
create table if not exists public.diary_entries (
  id           bigint generated always as identity primary key,
  question_id  bigint not null references public.questions(id) on delete cascade,
  date         date   not null,  -- YYYY-MM-DD
  time         text   not null,  -- "HH:mm"
  value        jsonb  not null,  -- boolean | number | string | string[]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  for_day      text not null default 'today' check (for_day in ('today','yesterday'))
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

## 6) Migration für bestehende Datenbanken

Falls du bereits eine Datenbank mit der alten `questions` Tabelle hast, führe dieses SQL aus, um das neue `time_of_day` Feld hinzuzufügen:

~~~
alter table public.questions
  add column if not exists time_of_day text not null default 'both' check (time_of_day in ('morning','evening','both'));

alter table public.questions
  add column if not exists ref_day text not null default 'today' check (ref_day in ('today','yesterday'));

alter table public.diary_entries
  add column if not exists for_day text not null default 'today' check (for_day in ('today','yesterday'));
~~~

## 7) Optionale Auto-Fragen für Nutzungsdaten (Android)

Diese Fragen werden von der App automatisch befüllt (Android UsageStats) und sollten auf "Abends" gestellt sein:

~~~
insert into public.questions (group_id, question, answer_type, unit, "order", active, time_of_day) values
  (null, 'Wie lange warst du heute am Handy? (Automatisch)', 'number', 'Min', 1001, true, 'evening'),
  (null, 'Zeit auf Social Media heute (Automatisch)', 'number', 'Min', 1002, true, 'evening'),
  (null, 'Zeit Musik/Audio heute (Automatisch)', 'number', 'Min', 1003, true, 'evening'),
  (null, 'Letzte App vor dem Schlafen (Automatisch)', 'text', null, 1004, true, 'evening');
~~~

Fertig. Starte die App neu. Wenn die Env-Variablen korrekt gesetzt sind, lädt die App die Fragen aus Supabase und schreibt Einträge in `public.diary_entries`.

## 8) Android (Native) Setup – UsageStats

Damit die App auf Android automatisch die tägliche Handynutzung erfassen kann, wird die Android-API `UsageStatsManager` verwendet. Das erfordert:

1) Berechtigung im Manifest
- Benötigte Permission (geschützt – der Nutzer muss sie in den Einstellungen freigeben):
~~~
<uses-permission
  android:name="android.permission.PACKAGE_USAGE_STATS"
  tools:ignore="ProtectedPermissions" />
~~~
- Achtung: Die `tools:`-Attribute erfordern die tools-XML-Namespace-Deklaration auf dem Wurzelknoten:
~~~
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
          xmlns:tools="http://schemas.android.com/tools"
          ...>
~~~

2) Native Module (Kotlin)
- Das Projekt bringt ein RN-Modul mit (Kotlin), das die folgenden Methoden exportiert:
  - `isUsageAccessGranted()`: Prüft, ob die Nutzungserlaubnis erteilt ist
  - `openUsageAccessSettings()`: Öffnet die entsprechende Android-Einstellungsseite
  - `getTodayUsageSummary(config)`: Liefert Tageswerte (gesamt, Social, Musik, letzte App)
- Package/Module:
  - `com.diary.usage.UsageStatsModule`
  - `com.diary.usage.UsageStatsPackage`
- Das Modul wird automatisch registriert (siehe Plugin unten). Falls du die Registrierung manuell übernimmst, füge in `MainApplication` die Package-Registrierung hinzu.

3) Expo Config Plugin
- In `app.json` ist ein lokales Plugin eingetragen: `"./plugins/withUsageStats"`.
- Dieses Plugin:
  - Fügt die Manifest-Permission (inkl. tools:ignore) hinzu
  - Versucht, `UsageStatsPackage` in `MainApplication` zu registrieren

4) Build als Custom Dev Client oder Release
- Da native Module genutzt werden, funktioniert das Feature nicht in Expo Go.
- Erstelle einen Custom Dev Client oder Release:
  - Prebuild (falls nötig): `expo prebuild`
  - Dev Client: `eas build -p android --profile development`
  - Release: `eas build -p android --profile production`
- Installiere das erzeugte APK/AAB auf dem Gerät/Emulator.

5) Erste Inbetriebnahme
- Beim ersten App-Start wird die App versuchen, die “Usage Access”-Einstellungen zu öffnen.
- Erteile die Berechtigung für deine App (Paketname siehe `app.json` -> `android.package`).
- Optional: In den App-Einstellungen kannst du die tägliche Eintragszeit anpassen und manuell synchronisieren (“Jetzt synchronisieren”).

6) Supabase-Datenfluss
- Die App legt (falls nicht vorhanden) automatisch vier Fragen an (siehe Abschnitt 7).
- Einmal täglich (nach der eingestellten Uhrzeit) werden folgende Werte gespeichert:
  - Gesamtzeit am Handy (Minuten)
  - Zeit auf Social Media (Minuten)
  - Zeit Musik/Audio (Minuten)
  - Letzte App vor dem Schlafen (Name/Label)
- Die Einträge werden als normale `diary_entries` gespeichert, inklusive:
  - `date` und `time` (Erfassungszeitpunkt)
  - `for_day` = 'today' bzw. bei manuellen/anderen Fragen entsprechend der Einstellung 'today'/'yesterday'

7) Hinweise
- Hintergrund-Ausführung (Background Fetch) ist “best effort” – das OS kann Läufe verzögern/bündeln.
- Für exaktere nighttime-runs kann zusätzlich ein nativer WorkManager-Job in Betracht gezogen werden.
- Stelle sicher, dass die Migrationen aus Abschnitt 6 durchgeführt sind (neue Spalten `ref_day` und `for_day`).