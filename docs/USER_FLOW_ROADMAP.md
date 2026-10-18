# ForgeCommunity: Nutzerflüsse und nächste Schritte

Stand: 18. Oktober 2026, 00:15 UTC · veröffentlichte Sites-Version **v44**  
Quellstand: `43ae9cc8c9136019917c4a652528949a9db64fb7`  
Produkt: [ForgeCommunity](https://forge-community.dsgvision.chatgpt.site)

## Entscheidung in Kürze

Die zuletzt beobachteten Kontext-, Kommentar- und Bearbeitungsprobleme sind als begrenzte Pakete ausgeliefert. Der Lernweg ist direkt erreichbar; Wissensdatenbank, Projekte, Ressourcen und Mitglieder behalten ihren jeweiligen Suchkontext in der URL. Das bedeutet noch keine vollständige Abnahme aller Zustände.

Die nächsten drei Pakete sind:

1. **Den ausgelieferten Space-Kernfluss mit einem wirklich benötigten Space positiv abnehmen.** Die nötigen Basis- und Postingports sind vorhanden; die passende reale Situation fehlt noch.
2. **Den bestehenden privaten Missionsfluss in eng gekoppelten D1-Stufen vervollständigen.** Private Zugangsänderungen und Missionsmutationen bleiben technische Quellenblocker.
3. **Ressourcen-Metadaten sicher für die Worker-Laufzeit portieren.** Der ruhige Fallback funktioniert; der eigentliche Abruf bleibt offen.

Keine weiteren Oberflächen oder Engagementmechaniken nur zum Füllen leerer Menüs. Neue Änderungen benötigen einen konkreten Befund und einen begrenzten Auftrag.

## So ist der Status zu lesen

- **Ausgeliefert:** im veröffentlichten Quellstand enthalten und vor Veröffentlichung technisch geprüft.
- **Live bestätigt:** der ausdrücklich genannte Teilfluss wurde auf der veröffentlichten Website beobachtet.
- **Abnahme offen:** für diesen Zustand fehlt eine passende echte Situation oder eine gezielte veröffentlichte Prüfung.
- **Quellenblocker:** ein konkreter vorhandener Aufrufpfad ist mit der Laufzeit inkompatibel; daraus wird kein neuer Browserfehler behauptet.
- **Vorschlag:** Produktentscheidung, keine bereits zugesagte Funktion und kein nachgewiesener Defekt.

Leere Listen beweisen weder eine kaputte Funktion noch einen erfolgreichen positiven Fluss. Die folgenden Abnahmen sind begrenzte Prüfungen, keine Aussage über vollständige Barrierefreiheit oder sämtliche Geräte, Rollen und Fehlerfälle.

## 1. Ausgeliefert und tatsächlich geprüft

| Nutzerfluss | Ausgelieferter Stand | Tatsächliche Live-Abnahme | Noch offen |
| --- | --- | --- | --- |
| Persönlichen Lernfortschritt verstehen | Community-Fortschritt mit historischen Kursabschlüssen, getrennten aktiven Kurspunkten, echten 1/3/5-Kursmeilensteinen und vorhandenem Spark. Aktueller Stations-/Kapitelpfad mit bestätigtem nächsten Schritt. | Persönlicher Fortschritt und ein vollständig bearbeiteter Kurs mit Leserlinks sichtbar. | Echte unfertige Wiederaufnahme, offene Bewertung und nachträgliche Zugangssperre in einer passenden realen Situation. |
| Den Lernweg wiederfinden | v35: USER-Navigation, Schnellsuche, eindeutige Aktivmarkierung und berechtigte Kursauswahl per `course`-URL. v36: persönliches Menü konsistent; Staff bleibt beim Katalog. | Ein-Kurs-Fluss über Navigation und Schnellsuche per Tastatur, korrekte Aktivmarkierung, Reload und identischer Teil-Link bestätigt. | Mehrkurswechsel, Leser-Rückkehr, ungültige Kurs-ID und Loginrückkehr nicht zusätzlich live abgenommen. Konto-, Rollen- und Publikationsgrenzen sind quellengeprüft. |
| Wissensartikel lesen und wiederfinden | v29: lokale Richtexttypografie. v30: Suchbegriff, Kategorie und Tag URL-gebunden. | Echter Artikel mit Überschriften, Listen und Absätzen lesbar. Suche/Kategorie → Artikel → Zurück/Vorwärts, Reload, Teil-Link und Reset samt Suchfokus bestätigt. | Eigene Tag-Situation und manipulierte/mehrdeutige URL-Parameter nur quellengeprüft. |
| Globale Suche fortsetzen | v32: ehrlicher Lade-/Gastzustand mit Login-CTA und lokaler Rückkehradresse; angemeldete Suche erhalten. | Angemeldete Suche, Artikel-/Ressourcenfilter per Tastatur, Detail → Zurück und Reload erhalten den Kontext. | Gast-CTA und vollständige Loginrückkehr mangels unabhängigen anonymen Prüfkontexts noch nicht live abgenommen. |
| Projekte entdecken und lesen | v37: Titel und Metadaten haben volle Breite, Aktionen eine eigene Zeile. v39: Suche, tatsächlicher Tagfilter und Sortierung URL-gebunden. | Vorhandenes Projekt lesbar; ursprünglicher Desktop-Titelumbruch behoben. Suche/Sortierung → Detail → Zurück, Reload, identischer Teil-Link und Reset mit Fokus bestätigt. | Andere Tags, größere Listen, sämtliche Sortierungen und mobile Varianten nicht zusätzlich live abgenommen. |
| Ressourcen hinzufügen und wiederfinden | v31: unmittelbarer Submitguard, Pending-/Fehlerzustand und Öffentlichkeitshinweis. v39: Suche, Kategorie, Typ und Sortierung URL-gebunden. | Eine freigegebene echte Ressource einmal erstellt; Detail und Quellenlink nach Reload korrekt. Öffentlichkeitshinweis und native Pflichtfeldvalidierung bestätigt. Suche/Kategorie → Detail → Zurück, Reload, Teil-Link und Resetfokus bestätigt. | Kein zusätzlicher gültiger Submit nur für Rennen/Retry. Andere Typ-/Sortkombinationen und größere paginierte Datenmengen nicht live abgenommen. |
| Mitglieder nach Profilbesuch wiederfinden | v44: Suche, mehrere Skills/Rollen sowie vorhandene Sortierung/Richtung URL-gebunden. Kurzprofil und Ansicht bleiben lokal. | Suche plus vorhandener Rollenfilter und Datum-absteigend → eigenes Profil → Zurück und Reload erhalten denselben Treffer. Reset per Tastatur entfernt Suche/Rolle und fokussiert das Suchfeld; Sortierung bleibt erhalten. | Skillfilter, vollständige Vorwärtsserie, größere Datenmengen sowie unbekannte/doppelte Parameter und Lade-/Fehlerfälle nicht zusätzlich live abgenommen; die URL-Grenzfälle sind quellengeprüft. |
| Projekt bearbeiten | v41: unmittelbarer Speicherguard, vollständiger Snapshot, Pending-/Fehlerzustände und Schutz neuerer Dialogentwürfe. v43: vorhandener Richtexteditor statt roher HTML-Tags, stille Initialisierung und Rückkehrfokus. | Bestehende Beschreibung beim Öffnen als Richtext mit erhaltenen Absätzen sichtbar; initialer Titel-/Textboxfokus, Cancel und Escape zurück zu Bearbeiten bestätigt. | Kein gültiges Änderungs-PUT ausgeführt. Fehlerdraft, Close/Reopen während Speichern, Dateierhalt, Kontoabbruch und tatsächliche Editor-Eingaben nur quellengeprüft. Beliebige historische HTML-Formate sind damit nicht allgemein als verlustfrei editierbar abgenommen. |
| Ressource bearbeiten | v42: unmittelbarer Guard, Ziel-/Snapshotbindung, native Pendingsperren, Fehlerdraft und Close/Reopen-Schutz. v43: echter Openerref pro Karte. | Öffnen, initialer Titelfokus sowie Cancel/Escape zurück zum ursprünglichen Aktionen-Button bestätigt. | Keine gültige Änderung gesendet; Fehler, Retry, Pendingschließen und Kontowechsel nur quellengeprüft. |
| Projekt kommentieren und Links öffnen | v38: späterer Erfolg verwirft keine neuere Eingabe. v40: reine Textlinks für sichere explizite HTTP(S)-URLs. v41: neue Kommentare behalten gespeicherte Zeilenumbrüche. | Ein freigegebener echter Kommentar einmal gespeichert und nach Reload vorhanden; sichtbarer Sendezustand. Vorhandener Link anklickbar und per Tastatur erreichbar. | Weitertext während Pending wurde nicht rechtzeitig beobachtet. Mehrzeilen-Persistenz, Link-Grenzfälle und Fehlerrennen nur quellengeprüft. |
| Ressourcen ohne Vorschau lesen | v33: kompakter neutraler Fallback mit funktionierendem Quellenlink statt großem Fehlerblock. | Fallback, Tastaturzugang zur Quelle und Reload bestätigt. | **Der echte externe Metadatenabruf ist weiterhin technisch blockiert.** |
| Spaces lesen und schreiben | v31: D1-Diskussions-/Antwortreads. v34: Space-Erstellung und PUBLIC-Beitritt/Austritt. v36: Diskussions-/Antwort-POST. | Leeres Verzeichnis ohne erfundene Inhalte beobachtet. | Positiver Erstellen → Beitreten → Schreiben → Antworten → Reload-Fluss mit echten Berechtigungen noch nicht abgenommen. Private Mitgliedschaft und Moderation sind separate Restarbeiten. |

Die v28-Community-/Navigationsguards für Laden, angemeldet und anonym bleiben ausgeliefert. Eine vollständige aktuelle Gastprüfung wird dadurch nicht ersetzt. Die Bearbeitungs- und Kommentarfixes versprechen keine serverseitige Exactly-once-Garantie oder Abbruch eines bereits gesendeten Requests.

## 2. Klare offene Blocker

### B1 · Private Space- und Missionsmutationen

Die alte pauschale Aussage „Space-Erstellung und Posting sind nicht D1-kompatibel“ gilt nicht mehr: Space-Erstellung für PUBLIC/PRIVATE, eigene PUBLIC-Mitgliedschaft sowie Diskussions-/Antworterstellung haben native D1-Pfade.

Private Mitgliederverwaltung, die daran gekoppelten Widerrufe sowie Missions-, Merker-, Einladungs- und Moderationsmutationen sind weiterhin getrennt zu portieren. Die installierte D1-Prisma-Laufzeit lehnt die dort noch benutzten interaktiven Callbacktransaktionen ab. Missionsliste/-detail, private Missionsübersicht, Merkeransicht sowie Einladungsliste und Einladungspräferenz-GET haben bereits D1-Projektionen. Einladungs-Kandidatensuche, einzelne Einladung und die Auflösung solcher Benachrichtigungsziele bleiben dagegen ebenfalls callbackgebunden. Vorhandene Listen beweisen keine funktionierenden Schreibvorgänge. Zugriffsentzug darf nicht von Teilnahme-, Einladungs- und Merkerbereinigung entkoppelt werden.

### B2 · Weitere bestehende Callbackpfade

Umfrageliste/-detail einschließlich Erstellen, Abstimmen und Moderation sowie Lernpfad-Teilnahme POST/DELETE und die Admin-Lernpfaddefinition sind eigene quellenbelegte Restarbeiten. Die private Lernpfadansicht und Admin-GET sind bereits D1-Lesepfade. **Lernpfade** sind nicht die inzwischen verbesserte Route **Mein Lernweg**. Keine stillen globalen Transaktionsersetzungen und kein fertiger Teilnahme-/Abzeichenfluss, solange diese Pfade nicht portiert und passend abgenommen sind.

### B3 · Externer Ressourcen-Metadatenabruf

`lib/server/url-security.ts` verwendet `lookup()` aus `dns/promises`. Laut am 18. Oktober erneut geprüfter [Cloudflare-Workers-DNS-Dokumentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/) ist `lookup` nicht implementiert. **Quellenableitung:** der aktuelle Hostname-Abrufpfad scheitert vor dem Domainabruf und bleibt sicher geschlossen. Der vorhandene Quellenlink ist davon getrennt benutzbar.

Der sichtbare Fallback behebt diese Laufzeitlücke nicht. Historische konkrete Preview-Logs liegen nicht vor; eine spezielle Sperre der externen Website ist nicht belegt. Nur DNS auszutauschen wäre noch kein sicherer Transportport.

## 3. Die nächsten drei begrenzten Pakete

### Priorität 1 · Ausgelieferten Space-Kernfluss positiv abnehmen

- **Nutzersituation:** Eine Gruppe hat einen echten Austauschbedarf; ein Mitglied möchte beitreten, eine Frage stellen und eine Antwort lesen.
- **Ergebnis:** Der vorhandene offene Space-Fluss ist in der veröffentlichten App nachweislich nutzbar, ohne Rechteausweitung oder erfundene Aktivität.
- **Kleinster Scope:** zunächst ausschließlich die vorhandenen v34/v36-Pfade mit einem tatsächlich benötigten öffentlichen Space und passenden realen Rollen prüfen. Keine neue Space-Oberfläche, keine neue Mission und kein globaler Backendumbau. Ein neu gefundener Fehler erhält einen eigenen engen Reparaturauftrag; verbleibende Moderationsmutationen gelten nicht schon als repariert.
- **Abnahme:** berechtigter Admin erstellt den benötigten Space; normales Mitglied sieht ihn, kann vor Beitritt nicht schreiben, tritt freiwillig bei und veröffentlicht einen freigegebenen tatsächlichen Inhalt. Eine berechtigte Person antwortet. Liste/Detail/Reload erhalten den Inhalt; nach Austritt besteht keine Schreibberechtigung. Replay-/Doppelsubmitverhalten nur mit passenden autorisierten Situationen prüfen. Moderationsmutationen bleiben als B1 gesondert offen und sind kein Teil der bereits ausgelieferten Postingreparatur.
- **Abhängigkeit/Blocker:** legitimer Admin, echter Zweck, geeignete weitere Rollen und ausdrücklich erlaubte Inhalte. Ohne diese Situation bleibt die positive Abnahme offen; keine künstlichen Teilnehmer oder Antworten zur Beweisproduktion.

### Priorität 2 · Bestehenden privaten Missionsfluss vervollständigen

- **Nutzersituation:** Ein tatsächlich berechtigtes Space-Mitglied möchte eine Aufgabe erst merken und später selbst über Teilnahme und Beitrag entscheiden.
- **Ergebnis:** Der vorhandene private Zugang und „Gemerkte“-Fluss funktionieren; Merken wird weder Teilnahme noch Anerkennung zugerechnet.
- **Kleinster Scope:** den vorhandenen Kernfluss in einzeln prüfbare, aber fachlich gekoppelte D1-Stufen zerlegen: zuerst private Mitgliedschaft samt atomarem Zugriffsentzug; anschließend Mission anlegen/schließen und Merker; danach Teilnahme, Beitrag/Rücknahme und die dafür nötige Moderation. Bestehende Epochen, Revisionskonflikte, Request-Replays und Bereinigung bewahren. Kein Austausch des globalen Wrappers, keine neuen Missionsregeln oder Punkte.
- **Abnahme:** eine legitim erreichbare Mission merken → vorhandene Merkerliste → Detail → Reload; Entfernen bleibt unabhängig von Teilnahme. Zugriffsentzug, Schließen, alte Requests und Konto-/Rollenwechsel dürfen keine private Sichtbarkeit oder alte Berechtigung erhalten. Teilnahme und Beitrag brauchen weiterhin die echte Entscheidung des Mitglieds. Ein fertiger Gesamtfluss wird erst nach Abschluss aller benötigten Stufen behauptet.
- **Abhängigkeit/Blocker:** B1 und geeignete echte private Mitgliedschaft/Mission. Ein isolierter Bookmarkport ohne erreichbare Mission liefert noch keinen nutzbaren Fluss. Die dafür benötigte Einladungsbereinigung gehört zur gekoppelten Zugriffskorrektheit. Eigenständige Einladungsoberflächen oder Umfragen nur mit eigenem konkreten Bedarf gesondert beauftragen.

### Priorität 3 · Ressourcen-Vorschau sicher lauffähig machen

- **Nutzersituation:** Eine Person öffnet eine Ressource und möchte eine brauchbare Vorschau, sofern die externe Quelle sicher erreichbar ist.
- **Ergebnis:** Metadaten werden auf der Worker-Laufzeit kontrolliert geladen; andernfalls bleibt der bestehende ruhige Quellen-Fallback.
- **Kleinster Scope:** ausschließlich den bestehenden Preview-Abruf einschließlich DNS-/Transportbindung, Redirect-/Zielprüfung, Größen-/Zeitgrenzen und geeignetem Metadatenparser portieren. Erst einen tragfähigen Laufzeitvertrag festlegen; keine URLvalidierungslockerung, kein neuer Dienst, keine Host- oder Sicherheitsänderung beiläufig einführen.
- **Abnahme:** an einer passenden bereits freigegebenen öffentlichen Quelle echte Metadaten lesen; nicht verfügbare oder unzulässige Ziele bleiben geschlossen und verständlich. Gast-, angemeldeter-, Rate-Limit- und Fehlerzustand bleiben unterscheidbar; Quelle per Tastatur erreichbar. Keine erfolgreiche Vorschau nur aus einem HTTP-200 oder einem leeren Metadatenobjekt ableiten.
- **Abhängigkeit/Blocker:** B3; sichere Zielprüfung und tatsächlicher Transport müssen zusammenpassen. Falls das innerhalb des bestehenden Hostings nicht möglich ist, die Grenze offenlegen und den funktionierenden Fallback beibehalten.

## 4. Anerkennung, Wiederaufnahme und Speichern: bestehende Bedeutung erhalten

- **Abschlüsse und Punkte:** Historische unterschiedliche Kursabschlüsse und 1/3/5-Meilensteine sind von aktiven, widerrufbaren Kurspunkten getrennt. Abschlusszahl ist weder XP noch Punktezahl; ein Abschluss garantiert keine Punkte oder Zertifikatsausgabe.
- **Hilfreiche Antworten:** Private Anerkennung zählt aktuelle Auswahlen durch unterschiedliche berechtigte andere Autoren bis 5+. Sie ist reversibel, keine unabhängige Qualitätsprüfung und erzeugt keine neuen Punkte oder öffentlichen Abzeichen. D1-Schreiben für Lösungsauswahl ist ausgeliefert; positive Auswahl/Rücknahme bleibt ohne passende freiwillige Situation offen.
- **Spark:** vorhandene Figur, Sichtbarkeitseinstellung und reduzierte Bewegung erhalten. Kein zusätzlicher Feiermoment nur für Seitenaufrufe oder zur Wiederholung alter Erfolge.
- **Wiederaufnahme:** Der nächste Schritt folgt aktuellem bestätigtem Kursfortschritt, keiner erfundenen „zuletzt besucht“-Metrik. Verdienter Stationsabschluss und spätere Zugangssperre können gleichzeitig zutreffen. Mehrkurs- und unfertige Situationen müssen real geprüft werden, bevor weitergehende Aussagen folgen.
- **Speichern:** Vorhandene private Merker beziehen sich auf Missionen. Eine allgemeine Sammlung für Artikel, Beiträge oder Ressourcen ist bisher keine bestehende Funktion. Sie bleibt ein späterer Produktvorschlag mit eigenem privaten Datenvertrag.

## 5. Nachrangige Wünsche und fehlende Prüfsituationen

- Das Ressourcenformular bietet fünf technische Kategorien. Ein allgemeiner Lern-/Communityleitfaden lässt sich dadurch nur ungenau einordnen. Eine zusätzliche allgemeine Kategorie ist eine noch offene Produktentscheidung, kein aktueller Speicherfehler; bestehende Inhalte nicht ungefragt umkategorisieren.
- Benachrichtigungszustellung benötigt eine echte zulässige Antwort-/Empfängersituation. Eine leere Inbox belegt weder Fehler noch Erfolg.
- Gast-/Loginrückkehr, Mehrkurswechsel, unfertige Wiederaufnahme, offene Bewertung, Zugangsentzug, seltene URL-Grenzfälle sowie Pending-/Retryrennen bleiben bei den oben genannten Teilflüssen ausdrücklich offen.
- Erneute Bearbeitung realer Inhalte, weitere Kommentare oder zusätzliche Mitgliedsaktionen dienen nicht allein der Abnahme und brauchen den passenden Auftrag.

## Quellen und Verifikationsgrenze

Grundlage sind der oben genannte veröffentlichte v44-Quellstand, die bestätigte Auslieferungsfolge bis v44 und die ausdrücklich beschriebenen Beobachtungen auf der veröffentlichten Website vom 17./18. Oktober 2026 (UTC). Für dieses Dokument wurden keine Produktdaten verändert. Die vorherige v32-Roadmap wird damit inhaltlich fortgeschrieben; ältere offene Pakete werden nicht als weiterhin ungeändert ausgegeben.

Relevante Repositorypfade:

- **Spaces:** `lib/server/d1-space-base-writes.ts`, `d1-space-content-writes.ts`, `d1-space-discussion-reads.ts`, `space-api.ts`, `space-missions.ts`, `space-mission-bookmarks.ts`, `space-mission-invitation-state.ts`, `space-polls.ts` sowie die jeweiligen `app/api/spaces`-Routen.
- **Lernweg:** `lib/navigation.ts`, `components/Sidebar.tsx`, `navigation-search.tsx`, `user-nav.tsx`, `app/courses/journey/JourneyClient.tsx`, lokaler Kurs-URLhelper und bestehende Journey-/Readerprojektionen. Lernpfadteilnahme: `app/api/learning-pathways/[pathwayId]/participation/route.ts`.
- **Finden:** `app/knowledgebase`, `app/showcases`, `app/resources`, `app/members` mit ihren lokalen Verzeichnis-URLhelpern; `app/search/SearchPageClient.tsx`.
- **Schreiben/Lesen:** `app/projects/[projectId]/page.tsx`, `components/Editor.tsx`, `plain-text-links.tsx`, `app/api/projects/[projectId]/comments/route.ts`, `app/resources/page.tsx` und lokale Artikeltypografie.
- **Preview:** `components/ResourcePreview.tsx`, `app/api/resources/preview/route.ts`, `lib/server/url-security.ts`; offizielle DNS-Dokumentation wie unter B3 erneut geprüft.
- **Anerkennung:** `app/api/rewards/me/route.ts`, `lib/rewards.ts`, `components/community/PersonalProgressCard.tsx`, `ContributionMilestonesCard.tsx`, `lib/server/contributions.ts`, `accepted-solutions.ts`.

Notwendige Builds und Typprüfungen gehören vor eine Veröffentlichung; Funktionstests erfolgen ausschließlich auf der veröffentlichten Sites-Version. Keine neuen GitHub-CI-Testläufe für diese Dokumentpflege. Dieses Dokument behauptet weder eine vollständige Sicherheits-/Barrierefreiheitsabnahme noch einen Vergleichsvorsprung gegenüber anderen Produkten; Wettbewerberbehauptungen werden nicht verwendet.
