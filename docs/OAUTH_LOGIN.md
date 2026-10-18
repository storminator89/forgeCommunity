# Google- und OpenID-Connect-Anmeldung

Diese Anleitung gilt für die **Main-App mit NextAuth.js v4 und Prisma**. Die
separat veröffentlichte Sites-App hat eine eigene Serverimplementierung und
eigene Laufzeitvariablen. Eine Registrierung bei Google allein ersetzt weder
das Bereitstellen dieses Backends noch das sichere Hinterlegen der Zugangsdaten.

## Vorbereitete Administration: Anmeldung & SSO

Der neue Main-Quellkandidat enthält `/admin/authentication` für aktuelle ADMINs
und die API `/api/admin/oauth-configuration`. Er ist **nicht bereitgestellt**:
keine Main-Datenbankmigration, kein externer Schlüssel und keine echten
Providerzugangsdaten wurden eingerichtet. Das vollständige Setup-, Sicherheits-
und Recovery-Runbook steht unter [ADMIN-Konfiguration](OAUTH_CONFIGURATION_ADMIN.md);
die getrennt vorzubereitende Main-Migration unter
[Migrationsvorbereitung](OAUTH_CONFIGURATION_MIGRATION.md).

Nach einer gesondert freigegebenen Bereitstellung werden Client-ID, Secret und
OIDC-Einstellungen im geschützten ADMIN-Formular verwaltet. Der unabhängige
Hostschlüssel `OAUTH_CONFIG_ENCRYPTION_KEY` bleibt ausschließlich im Secret-Speicher
des Servers. Gespeicherte DB-Änderungen werden pro Request geladen und benötigen
keinen Neustart; Hostvariablen bleiben getrennte Servervoraussetzungen. Eine
vorhandene verschlüsselte DB-Konfiguration ersetzt die
Provider-Umgebungsvariablen vollständig, auch bei expliziter Deaktivierung;
bei Lesefehlern gibt es keinen stillen Rückfall. Leere Secretfelder behalten
nur bereits in dieser DB gespeicherte Secrets. Beim ersten Speichern muss ein
aktivierter Anbieter sein Secret frisch privat erhalten.

Die folgenden Provider-Umgebungsbeispiele beschreiben den bisherigen
Bootstrap-/Fallbackpfad **nur solange kein DB-Datensatz vorhanden ist oder die
optionale Tabelle nachweislich fehlt**. Dieser Env-Pfad benötigt selbst keine
neue Tabelle. Der neue ADMIN-Pfad benötigt dagegen die separat freizugebende
additive Tabelle und den externen Schlüssel. Die neuen SQL-Dateien liegen im
aktiven Main-Migrationsrunner und können beim später freigegebenen regulären
Upgrade mitlaufen. Die globale Main-Readiness verlangt weder die optionale Tabelle
noch deren Receipt; ausschließlich dieses bekannte Receipt darf fehlen oder mit
exaktem Checksum vorhanden sein. Alle bisherigen Pflichtmigrationen bleiben streng.
Fehlt die Tabelle, ist nur die ADMIN-Speicherfunktion gesperrt; bestehender
Credentialslogin und gewöhnlicher Mainstart bekommen keinen neuen Schemazwang.
Diese Vorbereitung selbst führt keinen Deploy, Start oder Datenbankbefehl aus.
SQLite-Container wenden im bisherigen Upgradepfad beim ausdrücklich freigegebenen
Start ausstehende Migrationen automatisch an. Die Sites-App bleibt getrennt.

## Bereits vorbereitet

- Passwortanmeldung bleibt verfügbar. Die bestehenden Ratenlimits, CSRF-Prüfung,
  JWT-Sitzungen, Datenbankrollen und Passwort-Fingerprints bleiben bestehen.
- Google und ein zusätzlicher OIDC-Anbieter sind unabhängig optional.
  `/login` lädt die tatsächlich verfügbaren Anbieter aus `/api/auth/providers`.
  Der Google-Button bleibt auch ohne vollständige Konfiguration sichtbar und ist
  dann mit „Noch nicht eingerichtet“ deaktiviert. Während die Liste lädt,
  erscheint „Wird geprüft…“; bei einem Ladefehler „Momentan nicht verfügbar“.
  Anklickbar wird er nur, wenn die Serverliste Google enthält. Sichtbarkeit
  aktiviert keine Anmeldung und umgeht keine serverseitige Prüfung.
- Beide Anbieter verwenden Authorization Code, PKCE S256, `state`, `nonce`,
  signierte RS256-ID-Tokens und ausschließlich `openid email profile`.
  Die NextAuth-/openid-client-Bibliotheken validieren den ID-Token einschließlich
  Signatur, Aussteller, Audience, Ablaufzeit und Nonce.
- Authorizationparameter werden serverseitig festgelegt. Requests können Scope,
  Client-ID, Redirect-URI, Response-Type und Response-Mode nicht überschreiben.
  Callbacks akzeptieren ausschließlich eine GET-Codeantwort mit State; direkte
  Frontchannel-ID-/Access-Tokens und hybride Antworten werden zurückgewiesen.
- Eine syntaktisch gültige, vom Anbieter bestätigte E-Mail-Adresse ist Pflicht:
  `email_verified` muss der JSON-Wert `true` sein. Fehlend, `false` oder der
  String `"true"` werden abgewiesen. OIDC-Anbieter müssen diese Claims im
  ID-Token liefern; ein beliebiges OAuth-2-Profil ohne OIDC genügt nicht.
- Rollen kommen ausschließlich aus der lokalen Datenbank. Neue Nutzer erhalten
  deren bestehende Standardrolle `USER`.
- Im Benutzer-Account wird nur die Identitätsverknüpfung gespeichert, kein
  Access-, Refresh- oder ID-Token des Anbieters. Die neue installationsweite
  Clientkonfiguration wird getrennt und verschlüsselt gespeichert. Bereits früher gespeicherte Tokens werden durch diese
  Änderung nicht gelöscht. Die Sitzung bleibt ein eigener NextAuth-JWT.
- Gleiche E-Mail-Adressen verbinden keine Konten. Bestehende Konten müssen
  weiterhin ihre bisherige Anmeldemethode verwenden. Auch bei bereits bestehender
  Sitzung wird kein neuer Anbieteraccount automatisch angehängt. Es gibt in
  dieser Änderung bewusst keinen Kontoverknüpfungs- oder Zusammenführungsdialog.

## 1. Öffentliche App-Adresse und Sitzungsschlüssel

Auf dem Server konfigurieren:

```dotenv
NEXTAUTH_URL="https://community.example.com"
NEXT_PUBLIC_APP_URL="https://community.example.com"
NEXTAUTH_SECRET=""
```

`NEXTAUTH_URL` ist genau die öffentliche Origin dieser Main-App, ohne Unterpfad,
Query, Fragment oder eingebettete Zugangsdaten. Produktion verlangt HTTPS.
`NEXTAUTH_SECRET` muss ein unabhängiger, zufällig generierter Schlüssel mit
mindestens 32 Zeichen sein, beispielsweise aus `openssl rand -base64 32`.
Den tatsächlichen Wert ausschließlich im Secret-Speicher der Laufzeitumgebung
hinterlegen. Ein Wechsel dieses Schlüssels meldet bestehende Sitzungen ab.

Die bestehende Datenbankkonfiguration und die Tabellen `User` und `Account`
müssen verfügbar sein. Nur der bisherige Env-Bootstrap-/Fallbackpfad benötigt
keine Schemaänderung und keinen neuen Dienst; der vorbereitete ADMIN-Pfad benötigt
die oben verlinkte neue Tabelle. Geheimnisse gehören nie in `NEXT_PUBLIC_*`, Git, den
Browser oder Screenshots. Änderungen der Servervariablen erfordern einen Neustart
der App; die verfügbaren Anbieter werden danach aus der Serverkonfiguration geladen.

## 2. Google-App registrieren

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein eigenes
   Projekt wählen oder anlegen und unter Google Auth Platform Branding, Zielgruppe
   und Kontaktangaben der eigenen App konfigurieren. Von Google verlangte
   Angaben und Domains müssen zum tatsächlichen Betreiber gehören.
2. Einen OAuth-Client des Typs **Webanwendung** anlegen.
3. Als autorisierte Weiterleitungs-URI exakt eintragen:
   `https://community.example.com/api/auth/callback/google`.
   Kein Wildcard, kein zusätzliches `/` und keine andere Schreibweise der Domain.
4. Falls nach JavaScript-Ursprüngen gefragt wird, ist die Origin
   `https://community.example.com`. Dieser serverseitige NextAuth-Login verwendet
   keinen Google-JavaScript-SDK und benötigt keine API-Zugriffe auf Gmail/Drive.
5. Bei einer externen App im Google-Testmodus berechtigte Testnutzer eintragen.
   Vor der allgemeinen Freigabe den passenden Veröffentlichungsstatus und etwaige
   von Google verlangte Prüfungen abschließen. Eine interne Workspace-Zielgruppe
   erlaubt nur Nutzer der gewählten Organisation.
6. Im künftig freigegebenen ADMIN-Pfad Client-ID und Secret privat unter
   `/admin/authentication` hinterlegen. Nur für den bisherigen Env-Bootstrap-/
   Fallbackpfad beide Werte direkt in der Serverumgebung hinterlegen:

```dotenv
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

Die Client-ID hat Googles Endung `.apps.googleusercontent.com`. Beide Werte müssen
vollständig gesetzt sein. Zusätzlich müssen `NEXTAUTH_URL` und `NEXTAUTH_SECRET`
die gemeinsamen Prüfungen aus Abschnitt 1 erfüllen. Nach dem Neustart wird
„Mit Google anmelden“ anklickbar, wenn `/api/auth/providers` Google zurückliefert.
Ohne vollständige gültige Konfiguration bleibt der sichtbare Button deaktiviert
mit „Noch nicht eingerichtet“; es wird kein Redirect gestartet. Dies bestätigt
noch keine erfolgreiche Anmeldung mit dem bei Google registrierten Client.
Kein Client-Secret in die öffentliche App-Konfiguration kopieren. Es wird kein
Offlinezugriff angefordert und keine zusätzliche Zustimmung zum Tokenrefresh
erzwungen.

Für die gewünschte öffentliche Domain lautet die Google-Redirect-URI:

`https://forge-community.dsgvision.chatgpt.site/api/auth/callback/google`

Das gilt nur für das Backend, das tatsächlich unter dieser Domain bereitgestellt
ist. Die Main-App muss dort ihre eigene NextAuth-Route bedienen; eine separat
laufende Main-App übernimmt nicht automatisch die Sites-Anmeldung. Keine
Domain-/Hoständerung ist Teil dieser Vorbereitung.

Für einen getrennten Entwicklungs-OAuth-Client kann Google zusätzlich
`http://localhost:3013/api/auth/callback/google` erhalten. HTTP wird von den
Konfigurationsprüfungen ausschließlich außerhalb der Produktion auf Loopback
erlaubt. Funktionstests für diese Änderung erfolgen entsprechend der
Projektfreigabe ausschließlich auf der veröffentlichten Sites-Version.

## 3. Weiteren OIDC-Anbieter vorbereiten

Geeignet ist ein vertrauenswürdiger OpenID-Connect-Anbieter mit Discovery,
Authorization Code, PKCE S256, Nonce und RS256, etwa eine passend konfigurierte
Keycloak-/Authentik-Instanz. Eine zusätzliche App benötigt einen vertraulichen
Webclient mit exakt dieser Redirect-URI:

`https://community.example.com/api/auth/callback/oidc`

Auf der gewünschten öffentlichen Domain entsprechend:

`https://forge-community.dsgvision.chatgpt.site/api/auth/callback/oidc`

Wieder gilt: Die URI muss auf das tatsächlich bereitgestellte Backend zeigen.
Die Provider-ID `oidc` und der Callbackpfad bleiben unabhängig vom Anzeigenamen.

Die folgende Servervariablenform gilt für den Env-Bootstrap-/Fallbackpfad. Im
vorbereiteten ADMIN-Formular werden dieselben Angaben privat eingegeben; neue
Speicherungen erlauben höchstens fünf zusätzliche Origins, während ein bereits
bestehender Main-Env-Bestand mit bis zu sechzehn Origins vollständig lesbar bleibt.

```dotenv
OIDC_ISSUER="https://identity.example.com/realms/community"
OIDC_CLIENT_ID=""
OIDC_CLIENT_SECRET=""
OIDC_NAME="Firmenkonto"
OIDC_TOKEN_AUTH_METHOD="client_secret_basic"
# Nur falls Discovery legitime zusätzliche Endpointorigins verwendet:
OIDC_ALLOWED_ENDPOINT_ORIGINS=""
```

- `OIDC_ISSUER` muss exakt dem veröffentlichten `issuer` und dem `iss` des
  ID-Tokens entsprechen, einschließlich eines gegebenenfalls vorhandenen
  abschließenden `/`. Die App verwendet die Discovery-Adresse
  `{issuer ohne abschließenden /}/.well-known/openid-configuration`.
- Der generische Issuer muss auch außerhalb der Produktion HTTPS und einen
  öffentlichen DNS-Namen verwenden. Zugangsdaten, Backslashes, Query und Fragment
  sind nicht erlaubt. IP-Literale einschließlich normalisierter alternativer
  IPv4-Schreibweisen und IPv6, Einwort-Hosts und lokale/reservierte Namenssuffixe
  wie `.localhost`, `.local`, `.internal`, `.lan` und `.home.arpa` sind gesperrt.
- `OIDC_CLIENT_ID` und `OIDC_CLIENT_SECRET` sind Pflicht. Als Tokenauthentifizierung
  sind ausschließlich `client_secret_basic` (Standard) und `client_secret_post`
  vorgesehen. Der gewählte Wert muss zur Clientregistrierung passen.
- Der Anzeigename ist optional und auf 60 Zeichen begrenzt. Ohne Namen erscheint
  „OpenID Connect“.
- Der Anbieter muss `sub`, `email` und `email_verified: true` im signierten
  ID-Token liefern. Nicht passende Anbieter werden nicht auf schwächere
  Prüfungen oder einen Userinfo-/E-Mail-Fallback umgestellt.

### Vertrauens- und Netzwerkgrenze

Der Issuer und `OIDC_ALLOWED_ENDPOINT_ORIGINS` sind ausschließlich private
Betreiberkonfiguration aus dem Host-Bootstrap oder dem geschützten, validierten
ADMIN-Konfigurationsendpoint. Sie werden nie aus Anmelde-Requestparametern,
Loginformularen, Callbackantworten oder Nutzerprofilen übernommen. Die Issuerorigin ist implizit
erlaubt. Weitere legitime Origins werden kommagetrennt als vollständige
HTTPS-Origins ohne Pfad angegeben, zum Beispiel
`https://login.example.com,https://keys.example.com`. Ungültige Einträge
deaktivieren OIDC; es gibt keine automatische Erweiterung der Liste.

Vor Sign-in und Callback lädt die App die höchstens 64 KiB große Discovery mit
fünf Sekunden Timeout und ohne Redirects. Der Metadaten-Issuer muss exakt stimmen.
Die konsumierten Authorization-, Token- und JWKS-URLs sowie ein gegebenenfalls
angegebener Userinfo-Endpunkt müssen sichere HTTPS-Adressen auf erlaubten
Origins sein. Code, Query-Response, PKCE S256, RS256 und die gewählte
Tokenauthentifizierung müssen von den Metadaten unterstützt werden. Erst danach
erhält NextAuth die festen validierten Endpunkte. Token-/JWKS-Anfragen der
installierten openid-client-v5-Implementierung folgen ebenfalls keinen
HTTP-Redirects. Es gibt keinen ungeprüften NextAuth-Discovery-Fallback.

Google verwendet ausschließlich fest eingebaute offizielle Endpunkte auf
`accounts.google.com`, `oauth2.googleapis.com` und `www.googleapis.com`; Requests
können sie nicht ändern.

Die URL-Prüfung führt bewusst keinen DNS-Lookup durch. Sie beweist daher nicht,
dass ein erlaubter öffentlicher DNS-Name ausschließlich auf öffentliche IPs
aufgelöst wird. Betreiber müssen die konfigurierten Domains und deren DNS sowie
die explizit erlaubten zusätzlichen Betreiber vertrauen; eine kompromittierte
Domain, DNS-Rebinding oder privat auflösende öffentliche Domainnamen werden hier
nicht durch DNS-Pinning abgefangen. Bei diesem Bedrohungsmodell ist zusätzlich
eine unabhängige ausgehende Netzwerkbeschränkung erforderlich. Diese Vorbereitung
ändert keine Netzwerk- oder Hosteinstellungen.

Die generische Identität ist `SHA-256(JSON.stringify([issuer, sub]))`, gespeichert
als `providerAccountId` unter `provider=oidc`. Gleiche Subjects verschiedener
Issuer bleiben verschiedene Identitäten. Google bleibt für bereits vorhandene
Konten kompatibel bei `provider=google` und `providerAccountId=sub`.
Ein Issuerwechsel, eine andere Clientregistrierung mit pairwise Subjects oder
eine spätere Identitätsmigration ist eine bewusste separate Aufgabe; E-Mail-
Übereinstimmung übernimmt keine alte Identität.

### Frameworkgrenze: Einmalverwendung und Logout

Diese Main-Variante verwendet die bestehende zustandslose NextAuth-v4-Prüfung:
providergebundene, verschlüsselte State-/PKCE-/Nonce-Cookies mit 15 Minuten
Gültigkeit und die vom Anbieter durchgesetzte einmalige Einlösung des
Authorization-Codes. NextAuth plant die Löschung der Prüfcookies beim Callback;
parallel eintreffende Requests können jedoch zuvor denselben Cookiezustand lesen.
Es gibt hier keine dauerhaft gespeicherte atomare Transaktionsverriegelung
(Compare-and-Swap/CAS) und keine Logoutgeneration für OAuth-Transaktionen.

Logout löscht den Sitzungscookie. Er widerruft ausstehende OAuth-Prüfcookies
nicht über eine dauerhafte serverseitige Logoutgeneration. Eine bereits
begonnene Anmeldung kann deshalb nach dem Logout noch erfolgreich abschließen.
Strengere Einmalverwendungs- und Logoutgarantien der separat entwickelten
Sites-Variante dürfen für diese Main-Implementierung nicht angenommen werden.
Vor Aktivierung sind diese Grenzen und Callback-/Logoutparallelität gesondert
zu berücksichtigen. Falls eine atomare serverweite Einmalverwendung oder das
Sperren aller ausstehenden Anmeldungen ab Logout gefordert ist, ist dafür vor
Freigabe eine eigene Erweiterung der Main-Variante erforderlich.

## Konfigurationsfehler und sichere Fehlerbehandlung

Im bisherigen Env-Bootstrap-/Fallbackpfad gilt: Beide Google-Werte leer deaktiviert Google. Alle drei erforderlichen OIDC-Werte
leer deaktiviert OIDC. Teilweise oder ungültige Werte deaktivieren nur den
betroffenen Anbieter. Ein ungültiger gemeinsamer `NEXTAUTH_URL`/`NEXTAUTH_SECRET`
deaktiviert beide optionalen Anbieter. Die Passwortanmeldung wird dadurch nicht
aus der Providerliste entfernt. Serverwarnungen nennen nur fehlende
Konfigurationskategorien, niemals eingegebene Werte. Bei vorhandenem DB-Datensatz
gelten ausschließlich dessen explizite Aktivierung und vollständige Konfiguration.
Ein nicht lesbarer oder nicht entschlüsselbarer Datensatz deaktiviert optionale
OAuth-Anbieter sicher; er wird niemals durch Env-Werte ersetzt. Die ADMIN-API
zeigt feste Blockercodes und keine Secrets, Hashes oder Ciphertexte.

Loginfehler werden über feste deutsche Texte angezeigt. Unbekannte oder mehr
als 64 Zeichen lange Fehlercodes erzeugen nur eine allgemeine Meldung;
`error_description`, Datenbankfehler und Tokens werden nicht ausgegeben.
Callbackziele sind auf 2.048 Zeichen und sichere lokale Pfade begrenzt. Nur
serverseitig werden absolute URLs derselben Origin akzeptiert. Andere Hosts,
Netzwerkpfade, Backslashes und Steuerzeichen fallen auf `/community` zurück.
OAuth-Debuglogs sind ausgeschaltet; der Authlogger schreibt nur begrenzte Codes.

## Abnahme nach autorisierter Bereitstellung

In dieser Vorbereitung wurden keine Provider-App registriert, keine Secrets
gesetzt und keine Anmeldung beim Anbieter ausgeführt. Auch keine neue GitHub-CI
und keine lokalen Funktionstests starten. Erlaubte lokale Prüfungen sind
Typprüfung und Produktionsbuild. End-to-End-Abnahme anschließend ausschließlich
auf der veröffentlichten Sites-Version, mit dafür freigegebenen Testkonten:

- Ohne Providerkonfiguration bleibt „Mit Google anmelden“ sichtbar und mit
  „Noch nicht eingerichtet“ deaktiviert; Passwortanmeldung unverändert.
- Nur serverseitig konfigurierte Anbieter sind anklickbar. Teilweise oder
  ungültige Google-Konfiguration bleibt deaktiviert, auch nach direktem Aufruf
  der Authroute; ein nicht konfigurierter OIDC-Anbieter bleibt ausgeblendet.
- Während des Ladens und bei Ladefehlern bleibt Google deaktiviert, ohne einen
  falschen Konfigurationsstatus anzuzeigen. Der Google-Button erscheint auch
  bei konfiguriertem Google nur einmal.
- Erfolgreiche Anmeldung mit bestätigter E-Mail, erneute Anmeldung desselben
  Accounts und normaler Logout.
- Abbruch, abgelaufene/manipulierte State-/Nonce-/PKCE-Transaktion, unbestätigte
  oder fehlende E-Mail und unzulässiges Callbackziel werden sicher behandelt.
- Überschriebene Authorizationparameter, Frontchannel-Tokens, doppelte oder
  unzulässige Callbackparameter, Discovery-Redirects und nicht freigegebene
  Endpointorigins führen zu keiner Anmeldung oder Accountänderung.
- Ein bestehendes Passwortkonto mit gleicher, auch anders geschriebener
  E-Mail-Adresse wird nicht übernommen oder verknüpft.
- Bei bestehender Sitzung wird ein neuer oder fremder Provideraccount nicht
  angehängt; nur die bereits passende Verknüpfung darf sich erneut anmelden.
- DB-Rollen und Passwortwechsel-/Sitzungsprüfungen behalten ihre Wirkung.
- Neue Accountverknüpfungen enthalten keine Provider-Tokens. Providerantworten
  und Secrets sind nicht in Browserbundles, Loginfehlern oder Authlogs sichtbar.

## Primärquellen

Stand der Recherche: 18. Oktober 2026. Die Implementierung bleibt bewusst bei der
installierten NextAuth-v4-API; keine stille Auth.js-v5-Migration.

- [NextAuth v4: Google-Konfiguration und Redirect-URI](https://next-auth.js.org/providers/google)
- [NextAuth v4: OIDC-/OAuth-Provider und Accountverknüpfung](https://next-auth.js.org/configuration/providers/oauth)
- [NextAuth v4: Sign-in- und Redirect-Callbacks](https://next-auth.js.org/configuration/callbacks)
- [NextAuth v4: Client-API und Providerliste](https://next-auth.js.org/getting-started/client)
- [Google: OpenID Connect und stabile Subjects](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google: OAuth für Webserver](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)

Die installierten Next.js-16.3.8-Guides zu Route Handlers, Environment Variables
und `useSearchParams` sowie der installierte NextAuth-/PrismaAdapter-Code wurden
vor der Implementierung geprüft.

