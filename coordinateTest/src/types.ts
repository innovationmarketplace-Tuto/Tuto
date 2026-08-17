export type Point = [number, number];
export type BBox = [number, number, number, number];
export type NormalizedPoint = { x: number; y: number };
export type NormalizedBounds = { x: number; y: number; width: number; height: number };

export type RegionKind = "line" | "word" | "page";
export type AnnotationType = "highlight" | "circle" | "underline" | "arrow" | "focus";

export interface Region {
  id: string;
  kind: RegionKind;
  polygon: Point[];
  bbox: BBox;
  ocrText?: string;
  confidence?: number;
  textType?: "HANDWRITING" | "PRINTED" | "UNKNOWN";
  source: "bda" | "fallback";
  parentId?: string;
  children?: string[];
}

export interface Annotation {
  type: AnnotationType;
  regionId: string;
  label?: string;
  reason?: string;
  confidence?: number;
  verified?: boolean;
}

export interface SemanticArtifact {
  regionId: string;
  transcription?: string;
  latex?: string;
  confidence?: number;
}

export type PageRegionKind = "problem" | "solution_step" | "equation" | "term" | "prose" | "diagram";

export interface ArtifactPage {
  id: string;
  artifactId: string;
  pageNumber: number;
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  revision: number;
}

export interface PageRegion {
  id: string;
  pageId: string;
  parentRegionId?: string;
  revision: number;
  kind: PageRegionKind;
  polygon: NormalizedPoint[];
  bounds: NormalizedBounds;
  transcription?: string;
  latex?: string;
  confidence?: number;
  source: "document_analyzer" | "text_detector" | "combined" | "derived";
}

export interface TutorAnnotation {
  id: string;
  pageId: string;
  targetRegionId: string;
  messageId: string;
  kind: AnnotationType;
  label?: string;
}

export interface TutorMessage {
  id: string;
  text: string;
  annotationIds: string[];
}

export interface DocumentOutput {
  transcription: string;
  latex: string;
  pages: ArtifactPage[];
  regions: PageRegion[];
  annotations: TutorAnnotation[];
  messages: TutorMessage[];
}

export interface AnalysisResult {
  requestId: string;
  message: string;
  annotations: Annotation[];
  regions: Region[];
  image: { width: number; height: number; mimeType: "image/jpeg" };
  document: DocumentOutput;
  providers: {
    bda: { status: "used" | "unavailable"; error?: string; segmentCount: number; artifactCount: number; lineCount: number; wordCount: number };
    nova: { status: "used" | "mock" | "unavailable"; modelId?: string; rawText?: string; stopReason?: string; artifactCount: number; latexAvailable: boolean };
  };
  warnings: string[];
}

export interface AnalyzeRequest {
  imageDataUrl?: string;
  imageBase64?: string;
  mimeType?: string;
  question?: string;
}
