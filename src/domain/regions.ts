/**
 * Canonical page geometry. See "Shared spatial contracts" in PROJECT_PLAN.md.
 * Raw provider (BDA/Nova) responses must stop at the document-analyzer adapter;
 * only these normalized shapes may reach the client.
 */

export type NormalizedPoint = {
  x: number; // 0-1 from the canonical page's left edge
  y: number; // 0-1 from the canonical page's top edge
};

export type NormalizedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageRegion = {
  id: string;
  pageId: string;
  parentRegionId?: string;
  revision: number;
  kind: "problem" | "solution_step" | "equation" | "term" | "prose" | "diagram";
  polygon: NormalizedPoint[];
  bounds: NormalizedBounds;
  transcription?: string;
  latex?: string;
  confidence?: number;
  source: "document_analyzer" | "text_detector" | "combined" | "derived";
};
