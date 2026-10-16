import { SpaceGlobeIcon, SpaceLockIcon } from './SpaceIcons';

export function SpaceVisibility({ visibility, explanatory = false }: { visibility: 'PUBLIC' | 'PRIVATE'; explanatory?: boolean }) {
  const isPrivate = visibility === 'PRIVATE';
  return <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
    {isPrivate ? <SpaceLockIcon className="h-4 w-4 shrink-0" aria-hidden="true" /> : <SpaceGlobeIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
    <span>{isPrivate ? explanatory ? 'Nur Mitglieder und Administratoren können Inhalte sehen.' : 'Privat' : 'Offen für Mitglieder'}</span>
  </span>;
}
