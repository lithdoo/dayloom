export interface SessionCommandSpec<T extends string> {
  name: T;
  aliases?: string[];
  summary: string;
}

export type ParsedSessionCommand<T extends string> =
  | { kind: 'command'; name: T; raw: string }
  | { kind: 'unknown'; raw: string }
  | { kind: 'text'; text: string };
