import { getSafeEmbedUrl, getSafeNavigationUrl, getYouTubeEmbedUrl } from '@/lib/security';
import { CourseContent, QuizContent, getQuizValidationError, parseQuizContent } from './types';

export type ContentType = CourseContent['type'];
export const EMPTY_QUIZ: QuizContent = { questions: [], shuffleQuestions: false, passingScore: 70 };

export const draftString = (value: CourseContent['content']): string => typeof value === 'string' ? value : JSON.stringify(value);
export const inferContentType = (content: CourseContent): ContentType =>
  content.type === 'TEXT' && parseQuizContent(content.content) ? 'QUIZ' : content.type;

/** Keep a temporarily empty numeric field editable; validate it only on submit. */
export function quizEditorDraft(value: CourseContent['content']): QuizContent | null {
  if (typeof value !== 'string' && typeof value.passingScore === 'number' && !Number.isFinite(value.passingScore)) {
    const parsed = parseQuizContent({ ...value, passingScore: 70 });
    return parsed ? { ...parsed, passingScore: value.passingScore } : null;
  }
  return parseQuizContent(value);
}

/** Legacy iframe snippets contribute only their source, never executable markup. */
export function getH5PEmbedUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const source = value.trim();
  if (/^[a-zA-Z0-9_-]+$/.test(source)) return `/h5p/embed/${encodeURIComponent(source)}`;
  const embedded = /^<iframe\b/i.test(source);
  const iframeSource = embedded ? source.match(/(?:^|\s)src\s*=\s*(["'])(.*?)\1/i)?.[2] : source;
  const decodedSource = embedded && iframeSource
    ? iframeSource.replace(/&(?:amp|quot|apos|lt|gt|#(?:[0-9]+|x[0-9a-f]+));/gi, entity => {
      const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
      const key = entity.toLowerCase();
      if (named[key]) return named[key];
      const hex = key.startsWith('&#x');
      const code = Number.parseInt(key.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    : iframeSource;
  return getSafeNavigationUrl(decodedSource);
}

export function getContentValidationError(type: ContentType, value: CourseContent['content']): string | null {
  const text = draftString(value).trim();
  if (type === 'QUIZ') {
    const quiz = quizEditorDraft(value);
    return quiz ? getQuizValidationError(quiz) : 'Die Quiz-Daten sind ungültig. Bitte korrigiere sie, bevor du speicherst.';
  }
  // Empty topics/lessons may be saved while their content is still being prepared.
  if (!text) return null;
  if (type === 'VIDEO' && !getCourseVideoUrl(text)) return 'Gib eine unterstützte Video-URL oder einen lokalen Medienpfad ein.';
  if (type === 'AUDIO' && !getSafeEmbedUrl(text, 'audio')) return 'Gib eine unterstützte Audio-URL oder einen lokalen Medienpfad ein.';
  if (type === 'H5P' && !getH5PEmbedUrl(text)) return 'Gib eine H5P-URL, Inhalts-ID oder einen Einbettungscode mit gültiger Quelle ein.';
  return null;
}

export function serialiseContent(value: CourseContent['content']): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Resolve supported provider page links to playable embeds. */
export function getCourseVideoUrl(value: string): string | null {
  const youtube = getYouTubeEmbedUrl(value);
  if (youtube) return youtube;
  const safe = getSafeEmbedUrl(value, 'video');
  if (!safe || safe.startsWith('/')) return safe;
  const url = new URL(safe);
  if (url.hostname === 'vimeo.com' || url.hostname === 'player.vimeo.com') {
    const id = url.pathname.match(/(?:^\/(?:video\/)?)(\d+)(?:\/|$)/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  if (url.hostname === 'dailymotion.com' || url.hostname === 'www.dailymotion.com') {
    const id = url.pathname.match(/\/(?:embed\/)?video\/([a-zA-Z0-9]+)(?:[_/?]|$)/)?.[1];
    return id ? `https://www.dailymotion.com/embed/video/${id}` : null;
  }
  return safe;
}

/** Audio provider pages need their iframe player; uploaded files use HTML audio. */
export function getCourseAudioEmbedUrl(value: string): string | null {
  const safe = getSafeEmbedUrl(value, 'audio');
  if (!safe || safe.startsWith('/')) return null;
  const url = new URL(safe);
  if (url.hostname === 'open.spotify.com') {
    const match = url.pathname.match(/^\/(?:intl-[a-z]+\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([a-zA-Z0-9]+)(?:\/|$)/);
    return match ? `https://open.spotify.com/embed/${match[1]}/${match[2]}` : null;
  }
  if (url.hostname === 'w.soundcloud.com') return safe;
  if (url.hostname === 'soundcloud.com') return `https://w.soundcloud.com/player/?url=${encodeURIComponent(safe)}`;
  return null;
}
