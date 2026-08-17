/**
 * Canonical pages. See "Canonical pages and layers" in PROJECT_PLAN.md.
 * The imageUrl/revision pair is immutable once analyzed; a rescan or edit
 * creates a new revision rather than mutating this record.
 */

export type ArtifactPage = {
  id: string;
  artifactId: string;
  pageNumber: number;
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  revision: number;
};
