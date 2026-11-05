/** Deliberately structural: no dependency on the application's shared schema. */
export interface Evidence {
  id: string;
  type: 'official_website' | 'uploaded_deck';
  title: string;
  url: string | null;
  documentId: string | null;
  page: number | null;
  publishedAt: string | null;
  retrievedAt: string;
  quoteOrSummary: string;
}
export interface IngestionResult { evidence: Evidence[]; limitations: string[] }
export class IngestionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'IngestionError';
  }
}
