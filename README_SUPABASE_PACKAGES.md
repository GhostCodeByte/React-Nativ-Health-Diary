# README: Supabase packages for OwnDiary

This app can use Supabase as its remote backend. To enable it, you only need to install the client package and configure environment variables. The code in src/services/supabase.ts already contains a thin wrapper and suggested SQL schema.

## 1) Install required package

- npm: npm i @supabase/supabase-js
- yarn: yarn add @supabase/supabase-js
- pnpm: pnpm add @supabase/supabase-js

Optional (recommended for some React Native environments):
- URL polyfill: npm i react-native-url-polyfill
- Then import once at your app entry (e.g., index.ts): import 'react-native-url-polyfill/auto'

## 2) Environment variables (.env)

Create a .env file in the project root and set only public values (EXPO_PUBLIC_*). Do not put your Service Role key here.

- EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
- EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
- EXPO_PUBLIC_SUPABASE_SCHEMA=public (optional; defaults to public)

Notes:
- Expo only exposes variables that start with EXPO_PUBLIC_ to the client bundle.
- After changing .env, restart the Expo dev server so the values are picked up.
- .env is already ignored by git.

## 3) Usage

The app will prefer Supabase automatically when EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are present. Otherwise, it falls back to the REST backend (if a URL is set in Settings) or local SQLite.

You can use the provided wrapper:
- Import from src/services/supabase:
  - isSupabaseConfigured()
  - supaGetGroups()
  - supaGetQuestions()
  - supaInsertDiaryEntry(entry)
  - supaInsertDiaryEntriesBulk(entries)
  - supaPing()

Minimal example (inline):
import { supaGetQuestions, supaInsertDiaryEntry } from '../services/supabase';
const questions = await supaGetQuestions();
await supaInsertDiaryEntry({ id: 0, questionID: questions[0].id, date: '2025-01-31', time: '07:45', value: true });

If you prefer a bare client:
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!);

## 4) Database setup

Use the SQL shown in SUPABASE_SETUP.md to create:
- public.groups
- public.questions
- public.diary_entries

With permissive RLS policies for anonymous read (meta) and insert (entries). You can harden policies later once auth is introduced.

## 5) Troubleshooting

- Ensure both EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are set and correct.
- Restart the Expo dev server after changing .env.
- On real devices, avoid localhost; Supabase uses a public URL so that is fine.
- If you encounter URL parsing errors, add the URL polyfill and import it once at app startup.
- Verify RLS policies allow the intended operations (select on groups/questions, insert on diary_entries).
