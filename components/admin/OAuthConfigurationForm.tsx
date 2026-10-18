'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const ENDPOINT = '/api/admin/oauth-configuration';
const MAX_TEXT_LENGTH = 2048;
const MAX_CLIENT_ID_LENGTH = 1024;
const MAX_PROVIDER_NAME_LENGTH = 60;
const MAX_SECRET_LENGTH = 4096;
const MAX_ENDPOINT_ORIGINS = 5;
// Main can already have up to 16 environment origins. Read the full existing
// list without truncation; new writes from this shared UI use the Sites limit.
const MAX_EXISTING_ENDPOINT_ORIGINS = 16;

type TokenAuthMethod = 'client_secret_basic' | 'client_secret_post';
type ConfigurationSource = 'environment' | 'database' | 'unconfigured';
type GoogleConfiguration = { enabled: boolean; clientId: string; clientSecretSet: boolean };
type OidcConfiguration = GoogleConfiguration & {
  name: string;
  issuer: string;
  tokenAuthMethod: TokenAuthMethod;
  allowedEndpointOrigins: string[];
};
type Configuration = {
  revision: number | null;
  canSave: boolean;
  blockers: string[];
  source: ConfigurationSource;
  callbackUrls: { google: string | null; oidc: string | null };
  providers: { google: GoogleConfiguration; oidc: OidcConfiguration };
};
type Draft = {
  google: { enabled: boolean; clientId: string };
  oidc: {
    enabled: boolean;
    name: string;
    issuer: string;
    clientId: string;
    tokenAuthMethod: TokenAuthMethod;
    originsText: string;
  };
};
type SavePayload = {
  expectedRevision: number | null;
  google: { enabled: boolean; clientId: string; clientSecret?: string };
  oidc: {
    enabled: boolean;
    name: string;
    issuer: string;
    clientId: string;
    clientSecret?: string;
    tokenAuthMethod: TokenAuthMethod;
    allowedEndpointOrigins: string[];
  };
};

const sourceLabels: Record<ConfigurationSource, string> = {
  environment: 'Umgebungsvariablen des Servers',
  database: 'Verschlüsselte Datenbankkonfiguration',
  unconfigured: 'Noch nicht eingerichtet',
};

// Blockers are status codes, never raw server error messages. Unknown codes are
// deliberately collapsed into a fixed message instead of being reflected to DOM.
const blockerLabels: Record<string, string> = {
  encryption_key_missing: 'Der externe Verschlüsselungsschlüssel ist noch nicht eingerichtet.',
  encryption_key_invalid: 'Der externe Verschlüsselungsschlüssel hat kein gültiges Format.',
  schema_missing: 'Die benötigte Datenbankstruktur ist noch nicht bereitgestellt.',
  base_url_missing: 'Die öffentliche Basis-URL ist noch nicht eingerichtet.',
  oauth_state_secret_missing: 'Auf Sites fehlt der externe Schlüssel für den geschützten OAuth-Ablauf.',
  oauth_transaction_not_ready: 'Die serverseitigen Voraussetzungen für den OAuth-Ablauf sind noch nicht freigegeben.',
  configuration_unavailable: 'Die gespeicherte Konfiguration kann derzeit nicht sicher gelesen werden.',
};

class ConfigurationHttpError extends Error {
  constructor(readonly status: number, readonly code?: 'oidc_identity_migration_required') {
    super('OAuth configuration request failed');
  }
}

async function configurationSaveError(response: Response): Promise<ConfigurationHttpError> {
  if (response.status === 409) {
    // Only this exact, allowlisted status code may affect the fixed UI text.
    // No message, error, unknown property, or body is reflected or logged.
    const body: unknown = await response.json().catch(() => null);
    if (typeof body === 'object' && body !== null && !Array.isArray(body) &&
      Object.hasOwn(body, 'code') && (body as Record<string, unknown>).code === 'oidc_identity_migration_required') {
      return new ConfigurationHttpError(409, 'oidc_identity_migration_required');
    }
  }
  return new ConfigurationHttpError(response.status);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid configuration');
  return value as Record<string, unknown>;
}

function text(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error('Invalid configuration');
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid configuration');
  return value;
}

function textList(value: unknown, maxItems = 50): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error('Invalid configuration');
  return value.map(item => text(item));
}

function parseConfiguration(value: unknown): Configuration {
  const body = record(value);
  const providers = record(body.providers);
  const google = record(providers.google);
  const oidc = record(providers.oidc);
  const callbacks = record(body.callbackUrls);
  const revision = body.revision;
  if (revision !== null && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)) {
    throw new Error('Invalid configuration');
  }
  const source = body.source;
  if (source !== 'environment' && source !== 'database' && source !== 'unconfigured') throw new Error('Invalid configuration');
  const tokenAuthMethod = oidc.tokenAuthMethod;
  if (tokenAuthMethod !== 'client_secret_basic' && tokenAuthMethod !== 'client_secret_post') throw new Error('Invalid configuration');

  // Construct an explicit non-secret allowlist. Never put an entire response,
  // an error response, or any unknown properties into React state.
  return {
    revision,
    canSave: bool(body.canSave),
    blockers: textList(body.blockers),
    source,
    callbackUrls: {
      google: callbacks.google === null ? null : text(callbacks.google),
      oidc: callbacks.oidc === null ? null : text(callbacks.oidc),
    },
    providers: {
      google: { enabled: bool(google.enabled), clientId: text(google.clientId, MAX_CLIENT_ID_LENGTH), clientSecretSet: bool(google.clientSecretSet) },
      oidc: {
        enabled: bool(oidc.enabled),
        name: text(oidc.name, MAX_PROVIDER_NAME_LENGTH),
        issuer: text(oidc.issuer),
        clientId: text(oidc.clientId, MAX_CLIENT_ID_LENGTH),
        clientSecretSet: bool(oidc.clientSecretSet),
        tokenAuthMethod,
        allowedEndpointOrigins: textList(oidc.allowedEndpointOrigins, MAX_EXISTING_ENDPOINT_ORIGINS),
      },
    },
  };
}

async function fetchConfiguration(signal: AbortSignal): Promise<Configuration> {
  const response = await fetch(ENDPOINT, {
    method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Accept: 'application/json' }, signal,
  });
  if (!response.ok) throw new ConfigurationHttpError(response.status);
  return parseConfiguration(await response.json());
}

function draftFrom(configuration: Configuration): Draft {
  return {
    google: { enabled: configuration.providers.google.enabled, clientId: configuration.providers.google.clientId },
    oidc: {
      enabled: configuration.providers.oidc.enabled,
      name: configuration.providers.oidc.name,
      issuer: configuration.providers.oidc.issuer,
      clientId: configuration.providers.oidc.clientId,
      tokenAuthMethod: configuration.providers.oidc.tokenAuthMethod,
      originsText: configuration.providers.oidc.allowedEndpointOrigins.join('\n'),
    },
  };
}

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

function buildPayload(configuration: Configuration, draft: Draft, googleSecret: string, oidcSecret: string): SavePayload {
  const origins = draft.oidc.originsText.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (origins.length > MAX_ENDPOINT_ORIGINS || origins.some(origin => {
    const url = httpsUrl(origin);
    return origin.length > MAX_TEXT_LENGTH || !url || url.pathname !== '/';
  })) throw new Error('Origins');

  const issuer = draft.oidc.issuer.trim();
  if (issuer && (!httpsUrl(issuer) || issuer.length > MAX_TEXT_LENGTH)) throw new Error('Issuer');
  if (draft.google.clientId.trim().length > MAX_CLIENT_ID_LENGTH || draft.oidc.clientId.trim().length > MAX_CLIENT_ID_LENGTH || draft.oidc.name.trim().length > MAX_PROVIDER_NAME_LENGTH) throw new Error('Provider field length');
  if (googleSecret.length > MAX_SECRET_LENGTH || oidcSecret.length > MAX_SECRET_LENGTH) throw new Error('Secret length');
  // Environment secrets must never be silently copied into the new database
  // record. Blank means keep only for secrets already stored in the database.
  const canKeepStoredSecret = configuration.source === 'database';
  if (draft.google.enabled && (!draft.google.clientId.trim() || ((!canKeepStoredSecret || !configuration.providers.google.clientSecretSet) && !googleSecret.trim()))) {
    throw new Error('Google credentials');
  }
  if (draft.oidc.enabled && (!draft.oidc.name.trim() || !issuer || !draft.oidc.clientId.trim() || ((!canKeepStoredSecret || !configuration.providers.oidc.clientSecretSet) && !oidcSecret.trim()))) {
    throw new Error('OIDC credentials');
  }

  return {
    expectedRevision: configuration.revision,
    google: {
      enabled: draft.google.enabled,
      clientId: draft.google.clientId.trim(),
      ...(googleSecret.trim() ? { clientSecret: googleSecret } : {}),
    },
    oidc: {
      enabled: draft.oidc.enabled,
      name: draft.oidc.name.trim(),
      issuer,
      clientId: draft.oidc.clientId.trim(),
      ...(oidcSecret.trim() ? { clientSecret: oidcSecret } : {}),
      tokenAuthMethod: draft.oidc.tokenAuthMethod,
      allowedEndpointOrigins: Array.from(new Set(origins.map(origin => new URL(origin).origin))),
    },
  };
}

function confirmsSave(configuration: Configuration, submitted: SavePayload, replacedSecrets: { google: boolean; oidc: boolean }): boolean {
  const google = configuration.providers.google;
  const oidc = configuration.providers.oidc;
  const expectedNextRevision = submitted.expectedRevision === null ? 1 : submitted.expectedRevision + 1;
  return configuration.revision === expectedNextRevision && configuration.source === 'database' &&
    google.enabled === submitted.google.enabled && google.clientId === submitted.google.clientId &&
    (!replacedSecrets.google || google.clientSecretSet) &&
    oidc.enabled === submitted.oidc.enabled && oidc.clientId === submitted.oidc.clientId &&
    oidc.name === submitted.oidc.name && oidc.issuer === submitted.oidc.issuer &&
    oidc.tokenAuthMethod === submitted.oidc.tokenAuthMethod &&
    (!replacedSecrets.oidc || oidc.clientSecretSet) &&
    JSON.stringify([...oidc.allowedEndpointOrigins].sort()) === JSON.stringify([...submitted.oidc.allowedEndpointOrigins].sort());
}

function CallbackField({ provider, value }: { provider: 'Google' | 'OIDC'; value: string | null }) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  useEffect(() => { setCopyMessage(null); }, [value]);
  const id = `${provider.toLowerCase()}-callback`;

  async function copyCallback() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage('Callback-URL kopiert.');
    } catch {
      setCopyMessage('Kopieren war nicht möglich. Bitte die Callback-URL im Feld markieren und manuell kopieren.');
    }
  }

  return <div className="space-y-2">
    <Label htmlFor={id}>Callback-URL für {provider}</Label>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input id={id} value={value ?? ''} readOnly placeholder="Wird nach der Server-Einrichtung angezeigt" className="min-w-0 font-mono text-xs" aria-describedby={`${id}-hint`} onFocus={event => event.currentTarget.select()} />
      <Button type="button" variant="outline" disabled={!value} onClick={() => void copyCallback()} aria-label={`${provider}-Callback-URL kopieren`}>
        <Copy className="h-4 w-4" aria-hidden="true" /> Kopieren
      </Button>
    </div>
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">Diese URL unverändert beim Anbieter als autorisierte Redirect-URI hinterlegen.</p>
    <p role="status" className="text-xs text-muted-foreground">{copyMessage}</p>
  </div>;
}

export default function OAuthConfigurationForm() {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [hasPendingSecret, setHasPendingSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const googleSecretRef = useRef<HTMLInputElement>(null);
  const oidcSecretRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const saveInFlight = useRef(false);

  const clearSecrets = useCallback(() => {
    if (googleSecretRef.current) googleSecretRef.current.value = '';
    if (oidcSecretRef.current) oidcSecretRef.current.value = '';
    setHasPendingSecret(false);
  }, []);

  const loadConfiguration = useCallback(async () => {
    if (saveInFlight.current) return;
    const sequence = ++requestSequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    clearSecrets();
    setLoading(true);
    setError(null);
    setNotice(null);
    setConfiguration(null);
    setDraft(null);
    try {
      const next = await fetchConfiguration(controller.signal);
      if (sequence !== requestSequence.current) return;
      setConfiguration(next);
      setDraft(draftFrom(next));
      setNeedsReload(false);
    } catch (cause) {
      if (sequence !== requestSequence.current || controller.signal.aborted) return;
      setError(cause instanceof ConfigurationHttpError && (cause.status === 401 || cause.status === 403)
        ? 'Die Konfiguration ist nur für aktuell angemeldete Administratoren verfügbar. Bitte neu anmelden.'
        : 'Die Konfiguration konnte nicht geladen werden. Bitte später erneut versuchen.');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [clearSecrets]);

  useEffect(() => {
    void loadConfiguration();
    return () => {
      requestSequence.current += 1;
      controllerRef.current?.abort();
      if (googleSecretRef.current) googleSecretRef.current.value = '';
      if (oidcSecretRef.current) oidcSecretRef.current.value = '';
    };
  }, [loadConfiguration]);

  const dirty = Boolean(configuration && draft && (
    JSON.stringify(draft) !== JSON.stringify(draftFrom(configuration)) || hasPendingSecret
  ));
  const blocked = !configuration?.canSave || Boolean(configuration?.blockers.length);
  const blockerMessages = configuration ? Array.from(new Set(configuration.blockers.map(code =>
    Object.hasOwn(blockerLabels, code) ? blockerLabels[code] : 'Eine weitere serverseitige Voraussetzung ist noch nicht erfüllt.'
  ))) : [];

  function secretChanged() {
    setHasPendingSecret(Boolean(googleSecretRef.current?.value || oidcSecretRef.current?.value));
    setNotice(null);
  }

  function changeGoogle(patch: Partial<Draft['google']>) {
    setDraft(previous => previous ? { ...previous, google: { ...previous.google, ...patch } } : null);
    setNotice(null);
  }

  function changeOidc(patch: Partial<Draft['oidc']>) {
    setDraft(previous => previous ? { ...previous, oidc: { ...previous.oidc, ...patch } } : null);
    setNotice(null);
  }

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configuration || !draft || blocked || loading || needsReload || saveInFlight.current || !dirty) return;
    setError(null);
    setNotice(null);
    let submitted: SavePayload;
    try {
      submitted = buildPayload(configuration, draft, googleSecretRef.current?.value ?? '', oidcSecretRef.current?.value ?? '');
    } catch {
      setError('Bitte die Angaben prüfen: Aktivierte Anbieter benötigen Client-ID und ein neues oder bereits in der Datenbank hinterlegtes Secret. Ein Secret aus Umgebungsvariablen muss bei der Erstübernahme erneut eingegeben werden. OIDC benötigt außerdem einen Namen und einen gültigen HTTPS-Issuer. Zusätzliche Origins müssen reine HTTPS-Origins ohne Pfad sein (höchstens 5).');
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    const sequence = ++requestSequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let accepted = false;
    const replacedSecrets = { google: Boolean(submitted.google.clientSecret), oidc: Boolean(submitted.oidc.clientSecret) };
    try {
      const response = await fetch(ENDPOINT, {
        method: 'PUT', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(submitted), signal: controller.signal,
      });
      // Submitted secrets are write-only and are never copied into application
      // state or storage. Error responses only use the allowlisted 409 code.
      delete submitted.google.clientSecret;
      delete submitted.oidc.clientSecret;
      clearSecrets();
      if (!response.ok) throw await configurationSaveError(response);
      accepted = true;
      const next = await fetchConfiguration(controller.signal);
      if (sequence !== requestSequence.current) return;
      const confirmed = confirmsSave(next, submitted, replacedSecrets);
      setConfiguration(next);
      setDraft(draftFrom(next));
      setNeedsReload(!confirmed);
      if (confirmed) setNotice('Konfiguration gespeichert und Serverstatus neu geladen. Ein erfolgreicher Anmeldeversuch wurde damit noch nicht geprüft.');
      else setError('Die Speicheranfrage wurde angenommen, aber der aktuelle Serverstand bestätigt die Änderung nicht eindeutig. Bitte neu laden und die Konfiguration prüfen.');
    } catch (cause) {
      if (sequence !== requestSequence.current || controller.signal.aborted) return;
      if (cause instanceof ConfigurationHttpError && cause.status === 409) {
        setNeedsReload(true);
        setError(cause.code === 'oidc_identity_migration_required'
          ? 'Bestehende OIDC-Konten können nicht auf einen anderen Issuer/Client umgestellt werden; eine Identitätsmigration ist erforderlich. Bitte den aktuellen Serverstand neu laden.'
          : 'Die Konfiguration wurde zwischenzeitlich geändert. Bitte neu laden und deine Änderungen danach erneut eingeben. Es wird nichts automatisch überschrieben.');
      } else if (cause instanceof ConfigurationHttpError && (cause.status === 401 || cause.status === 403)) {
        setConfiguration(null);
        setDraft(null);
        setError('Zum Speichern sind aktuelle Administratorrechte erforderlich. Bitte neu anmelden.');
      } else if (accepted) {
        setNeedsReload(true);
        setError('Die Speicheranfrage wurde angenommen, der Serverstatus konnte danach aber nicht geladen werden. Bitte vor einem weiteren Speichern neu laden.');
      } else {
        // A network failure may happen after the server committed the change.
        // Require a fresh revision before allowing a retry with an unknown outcome.
        setNeedsReload(true);
        setError('Die Änderung konnte nicht bestätigt werden. Bitte neu laden und den Serverstand prüfen. Neue Secrets müssen danach erneut eingegeben werden.');
      }
    } finally {
      delete submitted.google.clientSecret;
      delete submitted.oidc.clientSecret;
      clearSecrets();
      saveInFlight.current = false;
      if (sequence === requestSequence.current) setSaving(false);
    }
  }

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Administration</div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Anmeldung &amp; SSO</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">Google und OpenID Connect für diese Installation einrichten. Hauptanwendung und Sites verwalten ihre Konfiguration getrennt.</p>
      </div>
      <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-left" disabled={loading || saving} onClick={() => void loadConfiguration()}>
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        {dirty ? 'Änderungen verwerfen und neu laden' : 'Neu laden'}
      </Button>
    </header>

    <div aria-live="polite" aria-atomic="true">
      {loading && <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Konfiguration wird geladen …</p>}
      {notice && <p role="status" className="rounded-xl border bg-card p-4 text-sm">{notice}</p>}
    </div>
    {error && <p role="alert" className="rounded-xl border border-destructive/50 p-4 text-sm text-destructive">{error}</p>}

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" aria-hidden="true" /> Einmalige Server-Einrichtung</CardTitle>
        <CardDescription>Diese Voraussetzungen werden außerhalb dieser Oberfläche eingerichtet.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>Die Administration der Bereitstellung muss OAUTH_CONFIG_ENCRYPTION_KEY als externen Host-Schlüssel hinterlegen, die freigegebene Datenbankstruktur bereitstellen und die öffentliche Basis-URL konfigurieren. Auf Sites ist zusätzlich OAUTH_STATE_SECRET erforderlich.</p>
        <p>Hier werden keine Host-Schlüssel geändert, keine Datenbankmigrationen ausgeführt und keine serverseitigen Betriebsfreigaben gesetzt. Schlüsselwerte gehören nicht in dieses Formular.</p>
      </CardContent>
    </Card>

    {configuration && draft && <>
      <section aria-label="Aktueller Serverstatus" className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-semibold">Aktueller Serverstatus</h2>
            <p className="text-sm text-muted-foreground">Quelle: {sourceLabels[configuration.source]} · Revision: {configuration.revision ?? 'Noch kein Datenbankstand'}</p>
          </div>
          <Badge variant={blocked ? 'outline' : 'secondary'}>{blocked ? 'Speichern gesperrt' : 'Konfiguration speicherbar'}</Badge>
        </div>
        {blocked && <div className="mt-3 space-y-2 text-sm" role="status">
          <p>Die Einrichtung kann erst gespeichert werden, wenn die Server-Voraussetzungen erfüllt sind. Bis dahin bleiben Secret-Eingaben gesperrt.</p>
          {blockerMessages.length > 0 && <ul className="list-disc space-y-1 pl-5">{blockerMessages.map(message => <li key={message}>{message}</li>)}</ul>}
        </div>}
        {configuration.source === 'environment' && <p className="mt-3 text-sm text-muted-foreground">Die angezeigten Einstellungen stammen derzeit aus Umgebungsvariablen. Beim ersten Speichern entsteht eine eigene Datenbankkonfiguration. Bestehende Env-Secrets werden dabei nicht automatisch kopiert. Für jeden Anbieter, der danach aktiviert sein soll, muss das Client-Secret hier privat erneut eingegeben werden.</p>}
      </section>

      <form onSubmit={event => void saveConfiguration(event)} autoComplete="off" className="space-y-6">
        <p className="text-sm text-muted-foreground">Neue Anbieter-Konfigurationen starten deaktiviert. Eine Aktivierung erfolgt erst, wenn du den Anbieter ausdrücklich aktivierst und speicherst.</p>
        <fieldset disabled={saving || needsReload} className="grid min-w-0 gap-6 xl:grid-cols-2">
          <legend className="sr-only">Anbieter konfigurieren</legend>
          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Google</CardTitle><Badge variant="outline">{configuration.providers.google.enabled ? 'Aktiviert (Server)' : 'Deaktiviert (Server)'}</Badge></div>
              <CardDescription>OAuth-Client für eine Webanwendung in Google einrichten.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-medium">
                <input type="checkbox" checked={draft.google.enabled} onChange={event => changeGoogle({ enabled: event.currentTarget.checked })} className="h-4 w-4 accent-primary" /> Google für Anmeldungen aktivieren
              </label>
              <CallbackField provider="Google" value={configuration.callbackUrls.google} />
              <div className="space-y-2"><Label htmlFor="google-client-id">Client-ID</Label><Input id="google-client-id" value={draft.google.clientId} maxLength={MAX_CLIENT_ID_LENGTH} onChange={event => changeGoogle({ clientId: event.currentTarget.value })} autoCapitalize="none" spellCheck={false} /></div>
              <div className="space-y-2">
                <Label htmlFor="google-client-secret">{configuration.source === 'database' && configuration.providers.google.clientSecretSet ? 'Client-Secret ersetzen (optional)' : 'Client-Secret'}</Label>
                <Input ref={googleSecretRef} id="google-client-secret" type="password" disabled={blocked} autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={MAX_SECRET_LENGTH} onChange={secretChanged} aria-describedby="google-secret-hint" />
                <p id="google-secret-hint" className="text-xs text-muted-foreground">{configuration.source === 'environment' ? 'Ein Secret aus Umgebungsvariablen wird nicht übernommen. Zum Aktivieren privat erneut eingeben.' : configuration.providers.google.clientSecretSet ? 'Ein Secret ist in der Datenbank hinterlegt. Leer lassen, um es beizubehalten.' : 'Noch kein Secret hinterlegt. Zum Aktivieren ist ein Secret erforderlich.'} Gespeicherte Secrets werden nie angezeigt. Eingaben werden nach der Speicheranfrage geleert.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>OpenID Connect</CardTitle><Badge variant="outline">{configuration.providers.oidc.enabled ? 'Aktiviert (Server)' : 'Deaktiviert (Server)'}</Badge></div>
              <CardDescription>Einen eigenen OIDC-Anbieter mit vertraulichem Web-Client einrichten.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-medium">
                <input type="checkbox" checked={draft.oidc.enabled} onChange={event => changeOidc({ enabled: event.currentTarget.checked })} className="h-4 w-4 accent-primary" /> OIDC für Anmeldungen aktivieren
              </label>
              <CallbackField provider="OIDC" value={configuration.callbackUrls.oidc} />
              <div className="space-y-2"><Label htmlFor="oidc-name">Anzeigename des Anbieters</Label><Input id="oidc-name" value={draft.oidc.name} maxLength={MAX_PROVIDER_NAME_LENGTH} onChange={event => changeOidc({ name: event.currentTarget.value })} placeholder="Zum Beispiel: Unternehmensanmeldung" /></div>
              <div className="space-y-2"><Label htmlFor="oidc-issuer">Issuer-URL (HTTPS)</Label><Input id="oidc-issuer" value={draft.oidc.issuer} maxLength={MAX_TEXT_LENGTH} onChange={event => changeOidc({ issuer: event.currentTarget.value })} placeholder="https://login.example.org" inputMode="url" autoCapitalize="none" spellCheck={false} aria-describedby="oidc-issuer-hint oidc-identity-hint" /><p id="oidc-issuer-hint" className="text-xs text-muted-foreground">Exakten Issuer aus der Anbieter-Dokumentation verwenden. Keine Discovery-, Login- oder Callback-URL eintragen.</p></div>
              <div className="space-y-2"><Label htmlFor="oidc-client-id">Client-ID</Label><Input id="oidc-client-id" value={draft.oidc.clientId} maxLength={MAX_CLIENT_ID_LENGTH} onChange={event => changeOidc({ clientId: event.currentTarget.value })} autoCapitalize="none" spellCheck={false} aria-describedby="oidc-identity-hint" /></div>
              <p id="oidc-identity-hint" className="text-xs text-muted-foreground">Bei bereits verknüpften OIDC-Konten schützt der Server Issuer und Client-ID vor einem Wechsel. Eine Umstellung erfordert eine gesonderte Identitätsmigration.</p>
              <div className="space-y-2">
                <Label htmlFor="oidc-client-secret">{configuration.source === 'database' && configuration.providers.oidc.clientSecretSet ? 'Client-Secret ersetzen (optional)' : 'Client-Secret'}</Label>
                <Input ref={oidcSecretRef} id="oidc-client-secret" type="password" disabled={blocked} autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={MAX_SECRET_LENGTH} onChange={secretChanged} aria-describedby="oidc-secret-hint" />
                <p id="oidc-secret-hint" className="text-xs text-muted-foreground">{configuration.source === 'environment' ? 'Ein Secret aus Umgebungsvariablen wird nicht übernommen. Zum Aktivieren privat erneut eingeben.' : configuration.providers.oidc.clientSecretSet ? 'Ein Secret ist in der Datenbank hinterlegt. Leer lassen, um es beizubehalten.' : 'Noch kein Secret hinterlegt. Zum Aktivieren ist ein Secret erforderlich.'} Gespeicherte Secrets werden nie angezeigt. Eingaben werden nach der Speicheranfrage geleert.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="oidc-token-auth-method">Authentifizierung am Token-Endpunkt</Label>
                <select id="oidc-token-auth-method" value={draft.oidc.tokenAuthMethod} onChange={event => changeOidc({ tokenAuthMethod: event.currentTarget.value as TokenAuthMethod })} className="flex h-11 w-full rounded-xl border border-input bg-card px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" aria-describedby="oidc-token-auth-hint">
                  <option value="client_secret_basic">client_secret_basic (HTTP Basic)</option>
                  <option value="client_secret_post">client_secret_post (Request-Body)</option>
                </select>
                <p id="oidc-token-auth-hint" className="text-xs text-muted-foreground">Die vom OIDC-Anbieter unterstützte Methode auswählen.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="oidc-origins">Zusätzlich erlaubte Endpoint-Origins (optional)</Label>
                <Textarea id="oidc-origins" value={draft.oidc.originsText} onChange={event => changeOidc({ originsText: event.currentTarget.value })} rows={3} maxLength={MAX_ENDPOINT_ORIGINS * (MAX_TEXT_LENGTH + 1)} autoCapitalize="none" spellCheck={false} placeholder="https://tokens.example.org" aria-describedby="oidc-origins-hint" />
                <p id="oidc-origins-hint" className="text-xs text-muted-foreground">Diese Oberfläche unterstützt höchstens 5 zusätzliche Origins. Nur falls Discovery Endpunkte auf zusätzlichen Hosts ausweist: eine explizit vertraute HTTPS-Origin pro Zeile, ohne Pfad, Zugangsdaten, Query oder Fragment. Der Issuer selbst muss hier nicht wiederholt werden. Keine Wildcards.</p>
                {configuration.providers.oidc.allowedEndpointOrigins.length > MAX_ENDPOINT_ORIGINS && <p className="text-xs text-muted-foreground">Der bestehende Serverstand enthält mehr als 5 Origins und wird vollständig angezeigt. Er bleibt bis zum Speichern unverändert. Für Änderungen über diese Oberfläche muss die Liste ausdrücklich auf höchstens 5 Einträge angepasst werden; es wird nichts automatisch gekürzt.</p>}
              </div>
            </CardContent>
          </Card>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5">
          <p className="max-w-2xl text-sm text-muted-foreground">{needsReload ? 'Vor weiteren Änderungen bitte den Serverstand neu laden.' : dirty ? 'Ungespeicherte Änderungen. Eine Aktivierung wirkt nach dem Speichern auf die Anmeldung dieser Installation.' : 'Keine ungespeicherten Änderungen.'}</p>
          <Button type="submit" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={saving || loading || blocked || needsReload || !dirty} aria-busy={saving}>
            {saving ? 'Wird gespeichert und geprüft …' : 'Konfiguration speichern'}
          </Button>
        </div>
      </form>
    </>}
  </div>;
}
