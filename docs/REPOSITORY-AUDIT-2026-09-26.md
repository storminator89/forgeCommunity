# Repository-Audit vom 26. September 2026

Basis: `main` nach PR #3 (`749a483349c1770bd271e4c3f3a3bb5073c21f1f`).
Prüfung von Authentifizierung, Berechtigungen, API-Eingaben, Datenintegrität,
Dateien/URLs, Kursen/Zertifikaten, Chat, Profilen und Containerbetrieb.
Sechs GPT-6-Sol-Agents mit Reasoning High arbeiteten in getrennten Bereichen;
die Integration und gegenseitige Reviews wurden zentral beaufsichtigt.

Dies ist eine quellcodegestützte Prüfung mit Regressionstests, kein Nachweis,
dass sämtliche denkbaren Fehler oder Angriffsmöglichkeiten ausgeschlossen sind.
Schweregrade berücksichtigen die vorhandenen Authentifizierungsgrenzen.

## Bestätigte Befunde und Änderungen

| ID | Schwere | Befund / Auswirkung | Umsetzung und relevante Dateien |
| --- | --- | --- | --- |
| A01 | Hoch | Viele JSON-Endpunkte lasen ungeprüfte, unbegrenzte Bodies; Speicherverbrauch und uneinheitliche 500-Antworten. | Gemeinsamer begrenzter JSON-Objektparser, standardmäßig 256 KiB; 400/413 statt Parserfehlern. `lib/server/api-input.ts`, schreibende APIs. |
| A02 | Hoch | Admin-Passwörter umgingen Registrierungsregeln und bcrypt-Grenze von 72 UTF-8-Bytes. | Gemeinsame Prüfung für Admin-Anlage/Änderung, bcrypt Kostenfaktor 12. `account-security.ts`, Admin-APIs. |
| A03 | Hoch | Bestehende Passwort-Sessions blieben nach Passwortänderung gültig. | JWT an HMAC des aktuellen Passwort-Hashes gebunden; alte Tokens ohne Marker verlangen neue Anmeldung. OAuth-Sessions bleiben nach ausdrücklich getrennter Policy gültig. `auth/[...nextauth]/options.ts`. |
| A04 | Hoch | Letzter Admin konnte herabgestuft werden; parallele Löschungen/Rollenwechsel konnten den Adminbestand auf null reduzieren. | Akteur, Zielrolle und Adminanzahl innerhalb serialisierbarer Transaktion geprüft; Konfliktantworten. `admin/users/[id]/route.ts`. |
| A05 | Mittel | Entfernte Mitglieder privater Chats konnten eigene alte Nachrichten bearbeiten. | Aktuelle Kanalberechtigung auch beim Bearbeiten erforderlich. `chat/messages/[messageId]/route.ts`. |
| A06 | Mittel | Skill-Empfehlungen beliebig wiederholbar, parallele Requests erhöhten Zähler mehrfach. | `SkillEndorsement` mit eindeutiger Kombination aus Empfehlendem/Userskill; Record und Zähler atomar. SQLite 0002 und PostgreSQL 0001. Historische Gesamtzahlen bleiben erhalten. |
| A07 | Mittel | Profil-Speichern löschte und erstellte alle Skills neu; IDs, Zähler und Empfehlungshistorie gingen verloren. | Bestehende Verknüpfungen erhalten, nur entfernte Skills löschen; Skill-ID und UserSkill-ID kompatibel behandeln. `users/[id]/profile`. |
| A08 | Mittel | Admin-Löschen eines Kursleiters scheiterte an Zertifikaten; tiefe Kurshierarchien konnten an Fremdschlüsseln scheitern. | Zertifikate vor Kursen entfernen, Inhalte von Blättern zur Wurzel löschen. `course-deletion.ts`, Admin- und Kurslöschung. |
| A09 | Mittel | Benutzerlöschung entfernte Empfehlungen, ließ aber fremde zwischengespeicherte Zähler unverändert. | Zähler im selben Löschvorgang konsistent reduzieren; inkonsistente Bestände führen zum Rollback. |
| A10 | Mittel | Artikeländerungen ignorierten `isPublished`; Entwürfe ließen sich nicht zuverlässig veröffentlichen. | Flag validieren und anwenden, bei fehlendem Feld bestehenden Status bewahren. `articles/[id]/route.ts`. |
| A11 | Mittel | Leere/ungültige optionale Kurszahlen wurden NaN; ungültige Datumswerte führten zu Datenbankfehlern. | Datums-, Zahlen- und Feldvalidierung vor Persistenz; leere optionale Werte als null. `courses/route.ts`. |
| A12 | Mittel | Parallele Zertifikatsausstellung konnte Duplikate erzeugen; PDF verwendete aktuelle Namen/Datum statt ausgestelltem Datensatz. | Serialisierbare Ausstellung mit Konfliktwiederholung; beide PDF-Wege nutzen unveränderliche gespeicherte Werte. Historische Zertifikats-IDs werden nicht dedupliziert/gelöscht. |
| A13 | Mittel | Kursverschieben prüfte Knoten außerhalb der Transaktion; konkurrierende Änderungen konnten Zyklen ermöglichen. Tiefe Inhalte fehlten in Antworten. | Beziehungen, Vorfahren und Reihenfolge innerhalb serialisierbarer Transaktion; rekursive Gruppierung. `courses/**/contents`, `group-course-contents.ts`. |
| A14 | Mittel | Legacy-ICS-Export hatte abweichendes Escaping und ungeeignete Unicode-Downloadnamen. | Gemeinsamer ICS-Generator, fester ASCII-Dateiname und no-store. `events/[id]/route.ts`. |
| A15 | Mittel | Bereits gespeicherte unsichere URLs erreichten Frontend-Link-/window.open-Senken. | HTTP(S)-Validierung an Render-/Navigationsstellen, sichere lokale Pfade, exakte Video-Hostprüfung. Ressourcen- und Profiloberflächen, `lib/security.ts`. |
| A16 | Mittel | Profil-Links wurden ignoriert; Skill-ID-Verträge widersprachen einander; gebrochene Levels gelangten in Integerfelder. | Persistierte Social-Links, beide IDs explizit, kompatible Mutationen, ganzzahlige Levels 0–100. |
| A17 | Mittel | Fehlende Typ-/Enum-Prüfungen in Chat und Benachrichtigungen; reine Bildnachrichten ohne content scheiterten. | Validierte IDs/Enums/Strings; leerer String für Bildnachrichten; 400/404 für Eingabe-/Objektfehler. |
| A18 | Mittel | Unbegrenzte Feed-/Kommentar-/Benachrichtigungsabfragen belasteten Server; Aktivitätsseiten übersprangen Ereignisse. | Begrenzte Seitenabfragen und angepasste Clients; Aktivitätsfeed global zusammenführen, dann paginieren. |
| A19 | Mittel | Große Profilwerte im JWT konnten übergroße Cookies und Anmeldeprobleme erzeugen. | Nur notwendige, begrenzte Identitäts-/Anzeigeclaims ins JWT; Profilfelder separat laden. |
| A20 | Mittel | Datenbankfehlerdetails und vollständige Artikelinhalte wurden unnötig ausgegeben. | Allgemeine Fehlerantworten; Payload-Logging entfernt, interne Diagnose verbleibt serverseitig. |
| A21 | Niedrig | SSE-Endpunkt hielt Verbindungen offen, ohne Ereignisse zu senden. | Nicht implementierter Transport antwortet explizit 501; bestehender Polling-Client bleibt aktiv. |
| A22 | Niedrig | Auth-Konfiguration verwies auf nicht vorhandene Fehler-/Abmelde-/Verifikationsseiten. | Ungültige Overrides entfernt; NextAuth-Standardseiten. |
| A23 | Niedrig | Chat-Polling konnte Antworten eines zuvor ausgewählten Kanals anzeigen. | Abbrechen veralteter Requests und Leeren nicht mehr zugänglicher Kanaldaten. |
| A24 | Mittel | Request-Abbruch konnte auf nie endende Stream-Cancellation warten; DNS-Auflösung der URL-Vorschau hatte kein Zeitlimit. | Cancellation nicht blockierend; DNS-Zeitlimit zusätzlich zum Fetch-Zeitlimit. Bestehende SSRF-IP-/Redirectprüfungen erhalten. |
| A25 | Mittel | Projektkommentare wurden ungefiltert als HTML gespeichert. | Sanitizing und Inhaltsprüfung vor Persistenz. `projects/[projectId]/comments/route.ts`. |
| A26 | Niedrig | Projekt-Neuanlage sendete JSON an eine Multipart-Route. | Formular verwendet den vorhandenen, jetzt validierten JSON-Endpunkt. `projects/new/page.tsx`. |
| A27 | Niedrig | Gleichzeitiges Folgen oder wiederholtes Entfolgen führte zu 500. | Eindeutigkeitskonflikt behandeln und Entfolgen idempotent machen. `users/[id]/route.ts`. |

## Datenbank- und Betriebsänderungen

SQLite erhält ausschließlich eine neue additive Migration. Bestehende Migrationen
und Zertifikats-IDs bleiben unverändert. Historische Skill-Empfehlungszahlen sind
nicht einzelnen Empfehlenden zuordenbar: sie bleiben erhalten; die Eindeutigkeit
gilt für neu erfasste Empfehlungen.

PostgreSQL erhält einen separaten, transaktionalen Upgrade-Runner mit Prüfsummen
und Deployment-Sperre. Er berücksichtigt das Prisma-URL-Schema und verweigert
unbekannte oder manipulierte Migrationshistorie. Neue, per `prisma db push`
initialisierte Entwicklungsdatenbanken benötigen die dokumentierte explizite
Baseline-Bestätigung. PostgreSQL-Schemata werden nicht beim App-Start verändert.
Die Runtime-Images enthalten die Upgrade-Skripte; SQLite wird weiterhin automatisch
vor dem Start migriert. Vorgehen und Befehle stehen in der README.

## Offene Funktionslücken und verbleibende Risiken

1. **Kursabschluss:** Es fehlt ein vollständiger serverseitiger Einschreibungs-/Abschlussworkflow. Lokaler UI-Fortschritt setzt keine vertrauenswürdige `Enrollment.completedAt`. Zertifikate werden deshalb nur bei bereits bestätigtem Abschluss ausgestellt. Bezahl- und Abschlussregeln müssen fachlich definiert werden; die Berechtigungsprüfung wurde nicht abgeschwächt.
2. **Verteiltes Rate-Limiting:** Zähler liegen pro Prozess im Speicher. Mehrere Instanzen/Neustarts teilen keine Sperren. Eine zentrale Begrenzung und korrekte Proxy-Konfiguration sind für skalierte Installationen erforderlich.
3. **Dateilebenszyklus:** Sichere serverseitige Zuordnung zum Eigentümer und Bereinigung verwaister öffentlicher Uploads fehlen. Die bestehende vorsorglich deaktivierte Löschfunktion bleibt deaktiviert, um referenzierte/fremde Dateien nicht zu löschen. Speicherquoten und Garbage-Collection sind Folgearbeit.
4. **Legacy-Uploads:** Früher öffentlich abgelegte private Chatbilder benötigen weiterhin eine betriebliche Daten-/Dateimigration. Aktuelle private Uploads sind geschützt; alte öffentliche Kopien verschwinden dadurch nicht automatisch.
5. **Profil-Datenschutz:** Angemeldete Mitglieder können E-Mail, Kontakt und letzte Anmeldung anderer Profile sehen. Das bestehende Produktverhalten bleibt erhalten; gewünschte Sichtbarkeits-/Einwilligungsregeln sind noch zu definieren.
6. **Skalierung:** Begrenzte API-Seiten lösen nicht sämtliche Datenmengenprobleme. Einige Clients laden sämtliche Seiten in den Browser; die Rangliste aggregiert alle Benutzer in der Anwendung. Auch verschachtelte Likes/Kommentare einzelner populärer Einträge können große Antworten erzeugen. Für große Communities sind bedarfsgesteuertes Laden und Datenbankaggregation erforderlich.
7. **OAuth-Policy:** Passwortänderungen widerrufen Passwort-Sessions. OAuth-Sessions hängen am externen Provider und werden dadurch nicht global abgemeldet. Ein providerübergreifender „Alle Sitzungen widerrufen“-Mechanismus ist nicht enthalten.
8. **Altdaten:** Bereits inkonsistente Empfehlungszähler, zyklische Kurshierarchien oder doppelte Zertifikate werden nicht automatisch destruktiv bereinigt. Solche Daten benötigen eine kontrollierte Reparatur; bestehende Zertifikatslinks bleiben gültig.
9. **UI-Duplikate:** Zwei Artikel-Editorrouten mit unterschiedlichen Funktionen bestehen weiter. Der ältere Editor bewahrt den Publikationsstatus, der Entwurfseditor setzt ihn ausdrücklich.
10. **Kalenderzugriff:** Der ältere ICS-Endpunkt ist öffentlich, der neuere erfordert Anmeldung. Beide verwenden denselben sicheren Generator; die bisherige Produkt-Zugriffspolitik bleibt unverändert.
11. **Nebenläufige Änderungen:** Das Löschen eines Notification-Cursors während des Nachladens kann spätere Seiten abbrechen; bereits geladene Nachrichten und der Gesamtzähler bleiben sichtbar. Sehr große Kursbäume können bei transaktionaler Löschung das Zeitlimit erreichen und rollen dann vollständig zurück.
12. **SQLite-Grenzen:** Einzelinstanz und lokales persistentes Dateisystem, keine geteilte Netzlaufwerkdatenbank. Groß-/Kleinschreibung nicht-ASCII-basierter Suchtexte hat weiterhin SQLite-spezifische Grenzen.

## Verifikation

Die zugehörige Pull-Request-CI führt TypeScript, ESLint ohne Warnungen, Jest,
SQLite-Migrationsprüfungen, echte PostgreSQL-Upgrades in einer isolierten
Testschema-Instanz, Produktionsbuild, Standalone-Smoke und Docker-Tests beider
Provider aus. Ergänzend wird der gebaute SQLite-Server über echte HTTP-Anfragen
auf Registrierung, Anmeldung, Ressourcen, Zertifikate und zentrale Auditfälle
geprüft. Verbindliche Ergebnisse sind am konkreten PR-Commit sichtbar; ein
bestandener Unit-Test allein ersetzt keinen Produktions-/Integrationstest.

Lokaler Integrationsstand: 193 Jest-Tests in 33 Suites, 6 SQLite-Migrationstests, TypeScript und ESLint ohne Warnungen, SQLite-Produktionsbuild, 11 Standalone-HTTP-Prüfungen sowie SQLite- und Audit-HTTP-Smoke erfolgreich. PostgreSQL und Docker werden zusätzlich im PR-Workflow geprüft.
