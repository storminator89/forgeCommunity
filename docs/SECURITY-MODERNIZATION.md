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

## Abschlussprüfung

Wird nach Zusammenführung der Änderungen mit den tatsächlichen Ergebnissen ergänzt.
