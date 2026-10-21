const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers },
  });
}

export function error(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

/** Copy a response, adding headers (asset responses are immutable). */
export function withHeaders(response: Response, headers: Record<string, string>): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...headers })) copy.headers.set(name, value);
  return copy;
}

/**
 * Parse a JSON body up to a size limit. Returns undefined if invalid.
 * Only navigator.sendBeacon needs text/plain; admin writes insist on
 * application/json so cross-site forms cannot send them without a preflight.
 */
export async function readJson(request: Request, maxBytes: number, allowTextPlain = false): Promise<unknown> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/json') && !(allowTextPlain && type.startsWith('text/plain'))) return undefined;
  const text = await request.text();
  if (text.length > maxBytes) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
