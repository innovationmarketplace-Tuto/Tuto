"use node";

import { internalAction } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { selectTutorProvider } from "../src/intelligence/providers";
import { validateTutorResult } from "../src/intelligence/validation";

const completeRef = makeFunctionReference<"mutation">("tutor:complete") as any;
const failRef = makeFunctionReference<"mutation">("tutor:fail") as any;

/**
 * Node-only provider boundary. The public `tutor:turn` action owns auth and
 * persisted context; this internal action only calls the configured provider
 * and passes strict, normalized output back to the persistence mutation.
 */
export const generate = internalAction({
  args: {
    ownerUserId: v.string(),
    turnId: v.id("tutorTurns"),
    input: v.any(),
    pageStorageId: v.optional(v.id("_storage")),
    pageMimeType: v.optional(v.string()),
    pageNaturalWidth: v.optional(v.number()),
    pageNaturalHeight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const input = args.input as any;
      if (args.pageStorageId) {
        const blob = await ctx.storage.get(args.pageStorageId);
        if (!blob) throw new Error("Canonical worksheet image is unavailable");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.byteLength === 0) throw new Error("Canonical worksheet image is empty");
        // Bedrock Converse accepts images up to 3.75 MB. OCR text remains a
        // safe grounding source for larger uploads instead of failing a turn.
        if (bytes.byteLength <= 3_750_000
          && (args.pageMimeType === "image/jpeg" || args.pageMimeType === "image/png")) {
          input.image = {
            mimeType: args.pageMimeType,
            bytes,
            naturalWidth: args.pageNaturalWidth,
            naturalHeight: args.pageNaturalHeight,
          };
        }
      }
      const selection = selectTutorProvider(process.env);
      const output = await selection.model.generateTurn(input);
      // Metadata is operational and intentionally sits outside the strict
      // tutor result contract; validate only the four learner-facing fields.
      const validated = validateTutorResult({
        reply: output.reply,
        skillResolutions: output.skillResolutions,
        candidateEvidence: output.candidateEvidence,
        annotations: output.annotations,
      }, input);
      return await (ctx as any).runMutation(completeRef, {
        ownerUserId: args.ownerUserId,
        turnId: args.turnId,
        result: {
          ...validated,
          ...(output.metadata ? { metadata: output.metadata } : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tutor provider failed";
      await (ctx as any).runMutation(failRef, {
        ownerUserId: args.ownerUserId,
        turnId: args.turnId,
        errorMessage: message,
      });
      throw error;
    }
  },
});
