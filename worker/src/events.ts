import type { Env } from './env';
import { error } from './http';

/** Gameplay event intake; implemented with analytics in phase 4. */
export async function handleEvents(request: Request, env: Env): Promise<Response> {
  void request;
  void env;
  return error(404, 'Not found.');
}
