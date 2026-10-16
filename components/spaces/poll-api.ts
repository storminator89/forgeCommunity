export interface SpacePoll {
  id: string;
  spaceId: string;
  question: string;
  createdAt: string;
  closedAt: string | null;
  hiddenAt: string | null;
  moderationRevision: number;
  options: Array<{ id: string; label: string; votes: number }>;
  totalVotes: number;
  ownVote: { optionId: string | null; revision: number };
  canVote: boolean;
  canManage: boolean;
}
export type PollRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
