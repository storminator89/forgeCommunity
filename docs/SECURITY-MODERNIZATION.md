# Sicherheitsanalyse und Modernisierung

Stand: 22.09.2026. Ausgangscommit: `f71182d07bf876db528b3e19390b05063ede86ce`.
Branch: `security/modernize-2026-09-22`.

## Umfang und Grenzen

Statische Quellcodeanalyse, Paketprüfung über npm, gezielte Regressionstests,
TypeScript-Prüfung und Produktionsbuild. Keine Tests gegen die produktive Webseite,
keine Änderung produktiver Datenbanken und kein Deployment. Ein fehlerfreier Build
oder ein npm-Audit ohne Treffer beweist nicht die Abwesenheit aller Sicherheitslücken.

## Ausgangsbefunde

| Priorität | Befund | Auswirkung |
| --- | --- | --- |
| Kritisch | JWT-Update übernimmt `session.user` aus dem Browser | Manipulation von Identität und Rolle |
| Hoch | URL-Prüfung und Netzwerkverbindung nutzen getrennte DNS-Auflösung | DNS-Rebinding/SSRF möglich; IPv6-Sonderbereiche unvollständig geprüft |
| Hoch | Profilaktualisierung liefert vollständigen Benutzerdatensatz | Passwort-Hash und interne Tokenfelder in API-Antwort |
| Hoch | Zertifikate ohne Prüfung eines abgeschlossenen Kurses | Unberechtigte Ausstellung |
| Hoch | Uploadprüfung vertraut gemeldetem MIME-Typ | Kein Nachweis eines gültigen Bildes |
| Mittel | Bildlöschung verwendet unvollständigen Pfadpräfixvergleich | Manipulierte Pfade können Geschwisterverzeichnisse erreichen |
| Mittel | Anmeldung/Registrierung ohne Begrenzung und inkonsistente E-Mail-Normalisierung | Missbrauch und fehlgeschlagene Anmeldungen |
| Funktionsfehler | Windows-`xcopy` im Build, deaktivierte TypeScript-Buildprüfung | Linux/Docker-Build defekt; Typfehler bleiben unentdeckt |
| Betrieb | Bekannte Demo-Passwörter, ignorierte Migrationsdateien | Unsichere Demo-Konten und nicht nachvollziehbare Schemaänderungen |

Das ursprüngliche `npm audit` meldet 38 betroffene Pakete/Abhängigkeitsknoten:
6 kritisch, 22 hoch, 8 mittel, 2 niedrig. Das sind keine 38 nachgewiesenen
Angriffspfade der Anwendung; transitive Abhängigkeiten werden mitgezählt.
Maschinenlesbare Details: `docs/audit-baseline.json`.

## Reihenfolge

1. Anmeldung, Sitzungen und Rollen absichern.
2. API-Berechtigungen, Datenfreigabe, Uploads und URL-Abfragen korrigieren.
3. Bibliotheken und Buildwerkzeuge auf verifizierte Versionen migrieren.
4. Regressionstests, Typprüfung und Build zusammenführen; Restbefunde dokumentieren.

## Quellen für die Migration

- Next.js 16: https://nextjs.org/docs/app/guides/upgrading/version-16
- Paketversionen und Advisories: npm Registry (`npm view`, `npm audit`)

## Betrieb nach dem Upgrade

- `NEXTAUTH_SECRET` beim Einspielen wechseln. Bestehende JWTs lassen sich nach der
  früheren Manipulationsmöglichkeit nicht zuverlässig als unverändert einstufen.
  Alle Benutzer müssen sich neu anmelden; dies ist beabsichtigt.
- Eine kanonische HTTPS-Adresse für `NEXTAUTH_URL` und `NEXT_PUBLIC_APP_URL` setzen.
- Proxy-Header nur vertrauen, wenn der eigene Reverse Proxy sie überschreibt.
  Bei mehreren Instanzen ist ein gemeinsam genutztes Rate-Limit erforderlich;
  ein lokaler Zähler ist kein verteiltes Missbrauchsschutzsystem. Ohne
  vertrauenswürdige Client-IP gelten gemeinsame Obergrenzen (100 Loginversuche
  je 15 Minuten, 100 Registrierungen je Stunde) plus Limits pro E-Mail. Diese
  Obergrenzen können bei Missbrauch auch legitime Nutzer betreffen; für einen
  öffentlichen Betrieb sind Proxy-Konfiguration und vorgelagerter Schutz nötig.
- Bestehende Daten auf E-Mail-Dubletten mit unterschiedlicher Großschreibung
  prüfen. Eine Bereinigung braucht eine fachliche Zuordnung und wird nicht
  automatisch auf einer produktiven Datenbank ausgeführt.
- Der Bestand besitzt keinen vollständigen serverseitigen Workflow zur
  Bestätigung von Kursabschlüssen. Neue Zertifikate dürfen deshalb nur für
  Datensätze mit bestätigtem `Enrollment.completedAt` ausgestellt werden.
  Ein clientseitiger Seitenbesuch ist kein verlässlicher Abschlussnachweis.
- Datenbankschema und Dateiuploads vor der Migration sichern und Änderungen
  zunächst mit einer Staging-Kopie prüfen. Es wurden keine produktiven Daten
  verändert. Ein vorhandenes System braucht eine geprüfte Migrationsstrategie.

## Umgesetzte Änderungen

- JWT-Updates übernehmen keine browserseitigen Identitäts- oder Rollenangaben.
  Sitzungen lesen Identität und Rolle erneut aus der Datenbank; gelöschte Konten
  verlieren Zugriff. Admin-Seiten prüfen die Rolle auch serverseitig.
- Entwürfe, private Kanäle, Kommentare, Benachrichtigungen und Kursinhalte prüfen
  Zugriffsrechte am jeweiligen Datensatz. Benutzerantworten enthalten keine
  Passwort-Hashes oder Wiederherstellungstoken.
- URL-Vorschauen prüfen DNS auch beim Verbindungsaufbau, sperren interne und
  reservierte IP-Bereiche sowie Weiterleitungen und begrenzen Zeit und Datenmenge.
- Bild-Uploads werden dekodiert und neu kodiert; Dateigröße, Pixelzahl und
  tatsächlicher Inhalt werden geprüft. Neue Chat-Bilder liegen außerhalb des
  öffentlichen Verzeichnisses und erfordern autorisierten Zugriff.
- Automatisches Löschen über gespeicherte Bild-URLs ist deaktiviert: Der alte
  Datenbestand enthält keinen belastbaren Eigentumsnachweis. Dadurch können
  verwaiste Dateien entstehen; eine spätere Bereinigung muss Eigentum und
  Referenzen nachweisen.
- Chat und Benachrichtigungen verwerfen verspätete Antworten nach Konto- oder
  Kanalwechsel. Profil, Einstellungen, Kalenderexport und Kursverschiebung
  wurden korrigiert. Zertifikate verlangen einen bestätigten Abschluss.
- Node 24, Next.js 16.3.5, React 19.3.0, Prisma 7.10.0, Zod 4 und Tiptap 3;
  Prisma verwendet den PostgreSQL-Treiberadapter und eine externe Konfiguration.
  NextAuth bleibt auf der aktuellen stabilen 4.x-Linie. Tailwind 3, Recharts 2
  und Resizable Panels 2 bleiben zunächst auf kompatiblen Hauptversionen.
- Das Lockfile enthält gezielte Overrides für verwundbare transitive Pakete.
  Der Deepmerge-Override für Prisma wird durch Clientgenerierung und
  Schemavalidierung geprüft. Zukünftige Upgrades müssen diese Overrides prüfen.
- Linux-kompatibler Standalone-Build, aktivierte TypeScript-Buildprüfung,
  ESLint 9, Jest 30, Node-24-Container ohne Root-Benutzer und GitHub Actions.

## Verbleibende Betriebs- und Funktionsgrenzen

- Alte `/images/uploads/chat-*`-Adressen werden vor der statischen
  Auslieferung mit `404` gesperrt. Alte Chat-Bilder sind bis zur Migration
  nicht verfügbar. **Vor produktivem Einsatz** alte Chat-Dateien anhand ihrer
  Nachrichten und Urheber in den privaten Speicher migrieren, Referenzen
  aktualisieren und öffentliche Kopien entfernen; auch externe Dateiserver/CDNs berücksichtigen.
  Mehrfach referenzierte oder
  verwaiste Dateien müssen einzeln geprüft werden. Dieser Branch greift nicht
  auf produktive Dateien zu.
- H5P besitzt weiterhin keinen eingerichteten Speicher oder Laufzeitdienst.
  Der Upload meldet deshalb `501` statt eines erfundenen erfolgreichen Uploads.
- Bestehende Zertifikate, Demo-Konten und früher veröffentlichte sensible Daten
  brauchen eine gesonderte Bestandsprüfung. Ein Code-Fix widerruft sie nicht.
- Datenbankintegration mit realem PostgreSQL, OAuth mit echten Zugangsdaten,
  vollständige Browser-E2E-Abläufe und Docker-Build wurden in dieser Umgebung
  nicht ausgeführt. Diese Prüfungen sind vor Freigabe in Staging erforderlich.
- ESLint meldet noch React-Compiler- und Hook-Warnungen im bestehenden UI.
  Compiler-Diagnosen werden als Warnungen geführt; die Kernregeln zur
  Hook-Reihenfolge und TypeScript-Buildfehler bleiben wirksam.

## Abschlussprüfung

Geprüfter Stand: 22.09.2026, Node 24.19.0.

| Prüfung | Ergebnis |
| --- | --- |
| Saubere Installation mit `npm ci` | Erfolgreich |
| `prisma generate` und `prisma validate` | Erfolgreich |
| Jest, `npm test -- --runInBand` | 24 Testsuiten, 139 Tests bestanden |
| TypeScript-Prüfung einschließlich Next-Routentypen | Erfolgreich im Produktionsbuild |
| `npm run lint` | 0 Fehler, 32 Warnungen |
| `npm run build` | Erfolgreich, Standalone-Artefakt erzeugt |
| `node scripts/smoke-standalone.mjs` | 11 HTTP-Prüfungen bestanden |
| `npm audit` | 0 bekannte Schwachstellen, alle Schweregrade |
| `git diff --check` | Erfolgreich |

Der HTTP-Test prüft Login, Auth-Metadaten, Zugriffsschutz, CSRF-Abweisung,
Auth-Bodylimits, gesperrte alte Chat-Dateien (auch kodierte Pfade und HEAD)
sowie öffentliche Bilder, die erst nach Serverstart geschrieben werden.
Der Audit-Snapshot liegt in `docs/audit-final.json`. Die CI wiederholt
Installation, Audit, Typprüfung, Lint, Tests, Build und HTTP-Prüfung.

Die Implementierung erfolgte nach Analyse mit Luna-xhigh-Agenten und einer
zusätzlichen unabhängigen Quellcodeprüfung. Der Pull Request bleibt ein Entwurf,
bis die beschriebenen Daten- und Stagingprüfungen erledigt sind.
