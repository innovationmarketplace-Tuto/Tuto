/**
 * Linked tutor annotations. See "Shared spatial contracts" in PROJECT_PLAN.md.
 * Annotations are deterministic renderer instructions over a PageRegion;
 * the model chooses a targetRegionId, never display coordinates.
 */

export type TutorAnnotation = {
  id: string;
  pageId: string;
  targetRegionId: string;
  messageId: string;
  kind: "highlight" | "circle" | "underline" | "arrow" | "focus" | "label";
  label?: string;
};

export type TutorMessage = {
  id: string;
  text: string;
  annotationIds: string[];
};
