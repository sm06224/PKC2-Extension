/**
 * PKC2 todo body (JSON stored as string): { status, description, date?, archived }.
 * Mirrors the host's `parseTodoBody` / `serializeTodoBody` contract.
 */
export function serializeTodoBody(description: string, date: string): string {
  const body: Record<string, unknown> = { status: 'open', description };
  if (date !== '') body['date'] = date;
  body['archived'] = false;
  return JSON.stringify(body);
}
