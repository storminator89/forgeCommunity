import type { ReactNode } from 'react';
import { getSafeHttpUrl } from '@/lib/security';

// Reject the whole token rather than linking a misleading normalized prefix.
const unsafeToken = /[\\\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;
const openingPunctuation = /^[([{<"'“‘«]*/;
const terminalPunctuation = /[.,!?;:"'”’»`]/;
const closingPairs: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' };

/** Remove prose suffixes, but keep balanced URL parentheses/brackets. */
function urlLabel(candidate: string) {
  const excess: Record<string, number> = { ')': 0, ']': 0, '}': 0, '>': 0 };
  for (const character of candidate) {
    if (character in closingPairs) excess[character] += 1;
    else {
      for (const closing of Object.keys(closingPairs)) {
        if (character === closingPairs[closing]) excess[closing] -= 1;
      }
    }
  }

  let end = candidate.length;
  while (end > 0) {
    const character = candidate[end - 1];
    if (terminalPunctuation.test(character)) end -= 1;
    else if (character in closingPairs && excess[character] > 0) {
      excess[character] -= 1;
      end -= 1;
    } else break;
  }
  return candidate.slice(0, end);
}

/** Plain text remains React text; only explicit valid web URLs become links. */
export function PlainTextLinks({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  // Keep a BOM inside its token so it rejects the whole candidate, not a suffix.
  for (const match of text.matchAll(/[\S\ufeff]+/g)) {
    const token = match[0];
    if (unsafeToken.test(token)) continue;
    const prefixLength = token.match(openingPunctuation)?.[0].length ?? 0;
    const candidate = token.slice(prefixLength);
    if (!/^https?:\/\//i.test(candidate)) continue;

    const label = urlLabel(candidate);
    if (/[<>"'`]/.test(label)) continue;
    const href = getSafeHttpUrl(label);
    if (!href) continue;

    const start = match.index + prefixLength;
    nodes.push(text.slice(cursor, start));
    nodes.push(
      <a key={start} href={href} target="_blank" rel="noopener noreferrer"
        aria-label={`${label} (öffnet in neuem Tab)`}
        className="text-primary underline underline-offset-4 [overflow-wrap:anywhere] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {label}
      </a>
    );
    cursor = start + label.length;
  }

  nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
