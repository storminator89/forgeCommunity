import { spaceDate, type SpaceAuthor } from './space-api';

export function SpaceAuthorLine({ author, date }: { author: SpaceAuthor; date: string }) {
  return <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{author.name || 'Mitglied'}</span><span aria-hidden="true"> · </span><time dateTime={date}>{spaceDate(date)}</time></p>;
}
