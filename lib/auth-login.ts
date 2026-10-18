/** Shared browser/server rules. Never render a provider's error_description. */
export const DEFAULT_LOGIN_CALLBACK = '/community';
const MAX_CALLBACK_LENGTH = 2048;
const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

export function safeLoginCallback(value: unknown, baseUrl?: string): string {
  if (typeof value !== 'string' || !value || value.length > MAX_CALLBACK_LENGTH ||
      UNSAFE_CHARACTERS.test(value)) return DEFAULT_LOGIN_CALLBACK;

  let path = value;
  try {
    if (!value.startsWith('/')) {
      if (!baseUrl) return DEFAULT_LOGIN_CALLBACK;
      const base = new URL(baseUrl);
      const target = new URL(value);
      if (target.origin !== base.origin || target.username || target.password) {
        return DEFAULT_LOGIN_CALLBACK;
      }
      path = `${target.pathname}${target.search}${target.hash}`;
    }

    // Check the decoded form too, so encoded network paths, backslashes and
    // control characters cannot become redirects after a later URL decode.
    const decoded = decodeURIComponent(path);
    if (!/^\/(?!\/)/.test(path) || !/^\/(?!\/)/.test(decoded) ||
        UNSAFE_CHARACTERS.test(decoded)) return DEFAULT_LOGIN_CALLBACK;
    return path;
  } catch {
    return DEFAULT_LOGIN_CALLBACK;
  }
}

const LOGIN_ERRORS: Record<string, string> = {
  OAuthAccountNotLinked: 'Mit dieser E-Mail-Adresse besteht bereits ein Konto oder du bist schon mit einem anderen Konto angemeldet. Melde dich mit der bisherigen Anmeldemethode an. Konten werden nicht automatisch verknüpft.',
  OAuthEmailUnverified: 'Für diese Anmeldung ist eine bestätigte E-Mail-Adresse beim Anbieter erforderlich. Bitte bestätige sie dort und versuche es erneut.',
  AccessDenied: 'Die Anmeldung wurde abgebrochen oder nicht erlaubt. Bitte versuche es erneut.',
  CredentialsSignin: 'Anmeldung fehlgeschlagen. Bitte prüfe deine E-Mail-Adresse und dein Passwort.',
  SessionRequired: 'Bitte melde dich an, um diese Seite zu öffnen.',
  Configuration: 'Diese Anmeldemethode ist momentan nicht verfügbar. Bitte nutze deine bisherige Anmeldemethode.',
};

export function loginErrorMessage(code: unknown): string {
  if (code === null || code === undefined || code === '') return '';
  if (typeof code === 'string' && code.length <= 64 && Object.hasOwn(LOGIN_ERRORS, code)) {
    return LOGIN_ERRORS[code];
  }
  return 'Die Anmeldung beim Anbieter konnte nicht abgeschlossen werden. Bitte versuche es erneut oder nutze deine bisherige Anmeldemethode.';
}
