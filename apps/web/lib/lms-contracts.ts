export interface WebLmsConnection {
  configured: boolean;
  state: string;
  lastSyncSuccessAt: string | null;
  lastSyncAttemptAt: string | null;
  lastErrorCategory: string | null;
  authorization?: {
    automaticConnection: string;
    browserSignInUrl: string;
    browserSignInTransfersAccess: boolean;
    reconnectRequired: boolean;
    verifiedAt: string;
    blockers: string[];
  };
}
export interface WebLmsWork {
  timezone: string;
  lastSyncSuccessAt: string | null;
  stale: boolean;
  truncated: boolean;
  items: Array<{
    category: string;
    title: string;
    courseTitle: string | null;
    kind: string;
    submissionStatus: string;
    dueAt: string | null;
    startsAt: string | null;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    source: string;
  }>;
}
