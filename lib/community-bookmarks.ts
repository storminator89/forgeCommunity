export type CommunityBookmarkKind = 'post' | 'comment';
export type CommunityBookmarkTarget = { kind: CommunityBookmarkKind; targetId: string };
export type OwnCommunityBookmark = CommunityBookmarkTarget & { saved: boolean; revision: number };
export type CommunityBookmarkInput = { saved: boolean; expectedRevision: number; requestId: string };
export type CommunityBookmarkFilter = 'all' | 'post' | 'comment';
export type SavedCommunityItem = OwnCommunityBookmark & {
  id: string;
  savedAt: string;
  title: string;
  excerpt: string;
  author: { name: string | null; image: string | null };
  href: string;
};
export type CommunityBookmarkPage = { items: SavedCommunityItem[]; nextCursor: string | null };
export const communityBookmarkKey = ({ kind, targetId }: CommunityBookmarkTarget) => `${kind}:${targetId}`;
export const COMMUNITY_BOOKMARK_BATCH_LIMIT = 200;
