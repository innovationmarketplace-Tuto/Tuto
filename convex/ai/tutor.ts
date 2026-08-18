"use node";

import { createTutorModel } from "../../src/intelligence/providers";
import type { TutorModelInput, TutorModelOutput } from "../../src/intelligence/contracts";

/**
 * Invoke the configured tutor from a Convex Node action. The caller supplies
 * only the typed tutoring context; provider configuration comes from the
 * server environment and defaults to the deterministic fake.
 */
export async function runConfiguredTutor(input: TutorModelInput): Promise<TutorModelOutput> {
  return createTutorModel(process.env).generateTurn(input);
}

