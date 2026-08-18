/**
 * The durable document context currently attached to a learner workspace.
 *
 * This is intentionally a small, serializable contract. The tutor receives
 * only the persisted page identity/revision and selected region IDs; raw
 * picker bytes and provider responses never cross the workspace boundary.
 */
export type LearnerDocumentContext = {
  pageId: string;
  pageRevision: number;
  activeRegionIds: string[];
};
