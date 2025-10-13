/**
 * Base TypeScript types for OwnDiary
 * - Settings for configuring optional remote backend
 * - Group and Question definitions
 * - DiaryEntry payload for storing user answers
 */

/**
 * ISO date string (e.g., "2025-01-31")
 */
export type ISODate = string;

/**
 * Time string in 24h HH:mm format (e.g., "07:45")
 */
export type TimeHHMM = string;

/**
 * Supported answer control types for questions.
 * - boolean: yes/no
 * - number: numeric input
 * - scale: range slider (min/max/step)
 * - text: free text
 * - multi: multi-select from options
 * - time: time input (HH:mm)
 * - boolean_then_time: first ask yes/no; if yes -> ask time (HH:mm), if no -> store false
 */
export type AnswerType =
  | "boolean"
  | "number"
  | "scale"
  | "text"
  | "multi"
  | "time"
  | "boolean_then_time";

/**
 * Value type saved for a diary entry, corresponding to AnswerType.
 * - boolean -> boolean
 * - number/scale -> number
 * - text -> string
 * - multi -> string[] (selected option values)
 * - time -> string ("HH:mm")
 * - boolean_then_time -> boolean | string (false when "no", "HH:mm" when "yes")
 */
export type EntryValue = boolean | number | string | string[] | null;

/**
 * Global app settings.
 * serverUrl:
 *  - null: offline/local-only mode (SQLite)
 *  - string: base URL to the remote REST API (e.g., "https://example.com/api")
 */
export interface Settings {
  serverUrl: string | null;
}

/**
 * A logical group that questions belong to.
 * order: integer used for sorting in UI
 */
export interface Group {
  id: number;
  name: string;
  order: number;
  description?: string | null;
}

/**
 * A single question presented to the user.
 * - answerType controls which input UI to render
 * - For 'scale', provide min/max/step
 * - For 'multi', provide options
 */
export interface Question {
  id: number;
  groupId: number | null;
  question: string;
  answerType: AnswerType;

  // scale/number configuration
  min?: number;
  max?: number;
  step?: number;

  // multi-select options
  options?: string[];

  // text input helpers
  placeholder?: string;
  unit?: string;

  // ordering and toggling in UI
  order?: number;
  active?: boolean;
}

/**
 * A recorded answer to a specific question.
 * - date/time are captured in local device time unless the API dictates otherwise
 * - value maps to the question's AnswerType
 */
export interface DiaryEntry {
  id: number;
  questionID: number;
  date: ISODate; // "YYYY-MM-DD"
  time: TimeHHMM; // "HH:mm"
  value: EntryValue;

  // optional metadata
  createdAt?: string;
  updatedAt?: string;
  synced?: boolean; // true if successfully synced to remote backend
}
