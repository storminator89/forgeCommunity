# ForgeCommunity: konkrete nächste Nutzerflüsse

Stand: 17. Oktober 2026, 22:19 UTC · veröffentlichte Sites-Version v32  
Quellstand: `00b1f61a0abced59a14896819054e3f244ccc97a`  
Produkt: [ForgeCommunity](https://forge-community.dsgvision.chatgpt.site)

## Entscheidung in Kürze

1. **Zuerst einen echten Space nutzbar machen.** Die Leseseiten sind weiter als die Schreibvorgänge. Ein weiteres leeres Menü oder eine neue Missionsoberfläche löst diesen Blocker nicht.
2. **Als kleinen parallelen Frontendschritt den Lernweg leichter wiederfinden und die Kursauswahl im Link erhalten.** Bestehende bestätigte nächste Lernschritte wiederverwenden.
3. **Danach den vorhandenen privaten Missionsfluss einschließlich „Merken“ vervollständigen.** Anerkennung bleibt an echte Abschlüsse und tatsächlich ausgewählte hilfreiche Antworten gebunden.

Den bereits beauftragten ehrlichen Preview-Fallback separat abschließen. Darüber hinaus nur P1-A und P1-B für den nächsten Arbeitsabschnitt einplanen; weitere Pakete bleiben nachgelagert. Datenarme Menüs werden nicht mit erfundenen Events, Projekten, Teilnehmern oder Engagement gefüllt.

## Was die Statusangaben bedeuten

- **Live bestätigt:** in der veröffentlichten Version im normalen Nutzerfluss beobachtet.
- **Ausgeliefert, Abnahme offen:** Änderung ist veröffentlicht und quellengeprüft, der betreffende Live-Zustand wurde noch nicht positiv geprüft.
- **Technischer Quellenblocker:** konkreter Aufrufpfad passt nicht zur eingesetzten Laufzeit; kein behaupteter neuer Live-Fehler.
- **Vorschlag:** sinnvoller nächster Produktentscheid, noch kein beobachteter Fehler.

„0 Einträge“ ist allein kein Defekt. Eine fehlende echte Prüfsituation ist keine bestandene Funktionsabnahme.

## 1. Bereits verbessert

| Fluss | Stand und Beleg | Verbleibende Grenze |
| --- | --- | --- |
| Community → persönlicher Lernfortschritt → Lernweg | Persönliche Karte mit echten historischen Kursabschlüssen, aktiven Kurspunkten, 1/3/5-Kursmeilensteinen und bestehendem Spark vorhanden. Der geprüfte Live-Fluss trennt aktive Kurspunkte von historischen Abschlüssen. | Abschlusszahl und aktive Punkte sind unterschiedliche Daten. Keine XP- oder Streakfunktion. |
| Lernweg → tatsächliche Kursstation | Vorhandener Stationspfad mit bestätigten Stationen, echten Kapiteln und verfügbarem nächsten Schritt. Am 21:51 UTC waren beim vorhandenen Kurs alle aktuellen Stationen und die Leserlinks sichtbar. | Eine echte **unfertige** Wiederaufnahme wurde damit nicht geprüft; es gab keine entsprechende Situation. |
| Wissensartikel lesen | v29 stellt Überschriften, Listen, Links, Absatzabstände und lange Inhalte im lokalen Readerstil wieder her; veröffentlichter Artikel live geprüft. | Kein Editor-/Sanitizerumbau. |
| Wissensdatenbank → suchen/filtern → Artikel → Zurück | v30 erhält Suchbegriff und Kategorie in der URL. Am 21:45–21:47 UTC: Zurück/Vorwärts, Teil-Link im neuen Tab, Reload und Reset samt Fokus live bestätigt. | Tags sowie unbekannte/doppelte URL-Parameter sind quellengeprüft, nicht mit eigener Live-Tag-Situation abgenommen. |
| Eine echte Ressource veröffentlichen | Einmalige Erstellung des geprüften Stack-Overflow-Leitfadens; danach genau eine Karte, korrekte Detailseite und funktionierender externer Quellenlink nach Reload, 21:53–21:54 UTC. | Vorschau wurde nicht geladen; Direktlink funktioniert. |
| Ressourcenformular | v31: ehrlicher Hinweis „Öffentlich, auch ohne Anmeldung. Dein Name wird angezeigt.“ und native Pflichtfeldvalidierung am 22:04 UTC live bestätigt. Sofortiger Doppelsubmitguard, Pendingzustand und Inlinefehler quellengeprüft. | Kein zweiter gültiger Inhalt nur zum Auslösen eines Pendingtests angelegt. |
| Community-/Navigations-Authzustände | v28 entfernt irreführende Mitgliedsaktionen bei loading/anonym und erhält öffentliche Ressourcen-/Über-uns-Navigation. | Nach dem damaligen Laufzeitreset ist kein unabhängiger anonymer Kontext für eine vollständige aktuelle Gastabnahme verfügbar gewesen. |
| Suche → Treffer → Zurück/Reload | v32 angemeldet am 22:12–22:13 UTC live bestätigt: eine Suche liefert echte Inhalte; Artikel-/Ressourcenfilter, Tastatur, Artikeldetail, Zurück und Reload erhalten den Kontext. | Der neue **Gast**-CTA samt Loginrückkehr ist ausgeliefert und quellengeprüft, noch nicht live als Gast abgenommen. |
| Space-Diskussionen lesen | v31 hat Detail-, Antwortenlisten- und Einzelantwort-GET auf geschützte D1-Leseprojektionen umgestellt. | Das geprüfte Spaces-Verzeichnis war am 22:04:51 UTC leer. Keine positive Thread-/Antwort-Fixture; Schreibvorgänge wurden dadurch nicht repariert. |

Echte vorhandene Inhalte: [Wissensartikel](https://forge-community.dsgvision.chatgpt.site/knowledgebase/cmvcwwaks0000psp7jra5nqah), [Ressource](https://forge-community.dsgvision.chatgpt.site/resources/cmvcxnyh50000psp7tlcwwzcu).

## 2. Was tatsächlich noch offen ist

### Technische Quellenblocker

**T1 · Space-Schreibvorgänge:** `spaceTransaction()` verwendet weiter interaktive Prisma-Callbacktransaktionen. Dazu gehören Space erstellen, offene Mitgliedschaft ändern, private Mitglieder verwalten, Diskussion/Antwort schreiben und Moderation. Die installierte D1-Prisma-Laufzeit lehnt diese Transaktionsform ausdrücklich ab. Die v31-Lesereparatur hebt das nicht auf. [S1–S3]

**T2 · Missionen und vorhandene private Merker:** Mission erstellen/schließen, Teilnahme ändern, beitragen/zurückziehen/moderieren sowie Merker und Einladungen laufen weiter über `spaceTransaction()` oder darauf aufbauende Wrapper. Übersichts- und Detailreads haben D1-Pfade; das belegt keine funktionierenden Mutationen. Private Mitgliedsentfernung ist an Teilnahme-, Einladungs- und Merkerwiderruf gekoppelt und darf nicht einzeln vereinfacht werden. [S4]

**T3 · Weitere vorhandene Funktionen:** Auch Umfrageliste/-detail verwenden noch den Callbackwrapper. Lernpfad-Teilnahme POST/DELETE hat einen eigenen interaktiven Callback. Beide sind getrennte, quellenbelegte Restarbeiten; weder Missionen noch Lernpfadbeitritt als bereits funktionsfähig verkaufen. Lernpfade sind außerdem nicht mit „Mein Lernweg“ identisch. [S5]

**T4 · Ressourcen-Metadatenabruf:** `lib/server/url-security.ts` verwendet `lookup()` aus `dns/promises` vor dem Abruf einer Hostname-URL. Diese API ist laut erneut geprüfter [Cloudflare-Workers-Dokumentation zu DNS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/) nicht implementiert. **Quellenableitung:** der aktuelle Metadatenpfad scheitert in dieser Laufzeit vor dem eigentlichen Domainabruf und bleibt sicher geschlossen. Historische Preview-Logs liegen nicht vor; damit ist die genaue Ursache des früheren Screenshots nicht nachträglich bewiesen. Ein nativer DNS-Ersatz allein wäre noch kein sicherer Transportport. [S8]

### Live beobachtete UX-Lücken

**U1 · Ressourcen-Vorschau:** Bei der neu angelegten Ressource erschien „Vorschau konnte nicht geladen werden“. Der Quellenlink war benutzbar. Die Ursache ist nicht aus der Oberfläche bestimmbar; es gibt keinen Beleg für eine spezielle Stack-Overflow-Sperre. [S8]

**U2 · Unpassende Ressourcen-Kategorien:** Das Formular bietet nur fünf technische Kategorien. Für den Leitfaden zum guten Fragenstellen wurde bewusst „Web Development“ gewählt, obwohl ein allgemeiner Community-/Lernbereich besser passen könnte. Das ist ein Taxonomiebedarf, kein fehlgeschlagener Speichervorgang. [S8]

### Fehlende Situationen und reine Vorschläge

- **Keine Spaces/Missionen sichtbar:** positiv leer beobachtet, keine Aussage über die Inhalte anderer Mitglieder. Für den gesamten positiven Fluss fehlen ein legitimer Space und die passenden Rollen.
- **Unfertigen Kurs wiederaufnehmen:** noch keine passende Live-Situation; kein nachgewiesener falscher nächster Schritt.
- **Allgemeine Inhaltsmerker:** an den inspizierten Beiträgen und Wissensartikeln nicht angeboten. Das Schema enthält Missionsmerker, keinen allgemeinen Post-/Artikel-/Ressourcenmerker. Eine globale „Gespeichert“-Sammlung wäre eine neue Funktion. [S6]
- **Antwort → Benachrichtigung:** keine passende echte Situation, leere Inbox. Zustellung ist damit weder bestätigt noch als kaputt nachgewiesen.
- **Hilfreichkeitsmeilensteine:** derzeit null. Das ist kein Fehler und kein Anlass, Auswahlhandlungen oder Antworten zu erfinden.

## 3. Priorisierte Umsetzungspakete

### P1-A · Vom leeren Space-Menü zur nutzbaren Diskussion

**Klasse:** T1, technische Reparatur vorhandener Funktionen. **Höchste Priorität**, sobald ein berechtigtes Administratorkonto und ein echter Verwendungszweck verfügbar sind.

- **Nutzersituation:** Ein Mitglied möchte einen passenden Space finden, beitreten und eine konkrete Frage mit anderen bearbeiten.
- **Gewünschtes Ergebnis:** Ein durch einen Admin angelegter offener Space ist für angemeldete Mitglieder sichtbar; echte Mitglieder können genau einmal veröffentlichen und antworten. Ein normaler USER erhält keine Adminrechte.
- **Kleinster sinnvoller Scope:** zwei getrennt prüfbare Änderungen statt Austausch des globalen Transaktionswrappers:
  1. Space-Erstellung und offenes Beitreten/Verlassen D1-kompatibel machen: `app/api/spaces/route.ts`, `app/api/spaces/[spaceId]/join/route.ts` plus enger D1-Schreibhelper.
  2. Diskussion/Antwort-Erstellung und erforderliche Moderationsmutationen für denselben Fluss portieren; bestehende Request-ID-/Digest-Replays, Rollen, ausgeblendete Inhalte und v31-Reads erhalten. Private Mitglieder, Missionen, Umfragen und Einladungen zunächst aus diesem Patch halten.
- **Abnahme:** Admin erstellt einen tatsächlich benötigten offenen Space; normaler USER sieht ihn, kann vor Beitritt nicht schreiben, tritt bei, schreibt eine echte Frage und eine berechtigte Person antwortet. Reload und Detail-/Listenwechsel erhalten den Inhalt. Wiederholter Submit erzeugt keinen zweiten Eintrag. Moderation greift; nach Austritt ist Schreiben gesperrt. Anonym kein Mitgliederzugriff.
- **Abhängigkeiten:** legitimer Admin und echte Inhalte; vor Veröffentlichung unabhängige Prüfung der atomaren Berechtigungs-/Schreibbedingungen. D1-kompatibel heißt nicht ungeschützte Folge einzelner Schreibbefehle.
- **Abschlussgrenze:** erst nach positivem veröffentlichtem End-to-End-Fluss als benutzbar markieren. Eine leere Liste oder ein erfolgreicher Build reicht nicht.

### P1-B · Den gleichen Lernweg wieder öffnen

**Klasse:** kleiner, quellenbegründeter **Vorschlag**, kein behaupteter Live-Bug. Kann unabhängig von P1-A umgesetzt werden.

- **Nutzersituation:** Ein Lernender kommt später zurück oder öffnet einen Link und will den bereits ausgewählten Kurs statt wieder den ersten Kurs sehen.
- **Gewünschtes Ergebnis:** „Mein Lernweg“ ist direkt auffindbar; die Auswahl eines angemeldeten Kurses ist als lokaler Link reproduzierbar.
- **Kleinster sinnvoller Scope:** zwei kleine Frontendschritte: (1) `lib/navigation.ts`, `components/Sidebar.tsx` und `components/navigation-search.tsx`: bestehende Route nur für Rolle USER aufnehmen, in sichtbarer Navigation und Schnellsuche gleich behandeln; `isNavigationActive` verhindert eine doppelte Markierung von Kurse/Lernweg. (2) `app/courses/journey/JourneyClient.tsx`, bei Bedarf ein kleiner reiner URL-Parser: einen `course`-Parameter nur gegen die aktuell berechtigte, geladene Kursliste auflösen. Kurswechsel schreibt History; Zurück/Vorwärts stellt die Auswahl wieder her. Keine neue Fortschrittsabfrage, keine automatische Anmeldung, kein accountbezogener Verlaufsspeicher. [S7]
- **Abnahme:** mit mindestens zwei echten angemeldeten Kursen Auswahl → Leser → Zurück, Teil-Link und Reload prüfen. Unbekannte, doppelte oder inzwischen nicht mehr berechtigte Kurs-ID fällt erst nach geladener Liste auf die bestehende sichere Auswahl zurück. Konto-/Rollenwechsel zeigt keine alte Personenauswahl; Staff-/Gastzustand erhält keinen irreführenden Lernenden-Navigationslink. Unfertig, abgeschlossen, Bewertung offen und gesperrt behalten ihre heutigen korrekten Aktionen. Auf 320 px und per Tastatur nutzbar.
- **Abhängigkeiten:** zunächst eine legitime unfertige Lernsituation für die positive Wiederaufnahmeabnahme. Vorhandene gemeinsame `projectJourney`-/Readersemantik unverändert lassen.
- **Wichtige Grenze:** „Nächster Schritt“ folgt bestätigtem aktuellem Fortschritt, nicht einer erfundenen Zuletzt-besucht-Metrik. Vollständige Station und spätere Zugangssperre dürfen gleichzeitig angezeigt werden.

### P2-A · Vorhandene private Missionen wirklich nutzen und wiederfinden

**Klasse:** T2; Reparatur einer bestehenden Funktion, kein neues Gamificationmodell. **Nach der Spacebasis**, nicht parallel als zusätzliche Oberfläche.

- **Nutzersituation:** Ein tatsächlich eingeladenes Space-Mitglied möchte eine offene Aufgabe erst merken, später freiwillig teilnehmen und einen hilfreichen Beitrag abgeben.
- **Gewünschtes Ergebnis:** Merken und Teilnahme sind zwei eigenständige Entscheidungen; die Mission erscheint zuverlässig unter „Gemerkte“ und bleibt privat.
- **Kleinster sinnvoller Scope:** ausschließlich den vorhandenen Missionsfluss portieren, in zwei prüfbaren Stufen: erst private Mitgliedschaft/Widerruf plus Mission erstellen/schließen und Merker; danach Teilnahme, Beitrag und Rücknahme einschließlich notwendiger Moderation. Enger D1-Helper statt globalem Callbackersatz. Vorhandene Epochen/Revisionskonflikte, Request-ID-Replays, Zugriffsentzug und gekoppelte Bereinigung bewahren. Neue Einladungsmechanik, Umfragen, Scoring und neue Wochenregeln gehören nicht dazu. Solange nur eine Teilstufe geprüft ist, ist der Gesamtfluss ausdrücklich noch nicht fertig. [S4]
- **Abnahme:** Admin stellt einen wirklich benötigten privaten Space mit tatsächlichen Mitgliedern bereit. Merken → „Gemerkte“ → Detail → Reload funktioniert, ohne Teilnahme oder Benachrichtigung auszulösen. Entfernen eines Merkers und konkurrierende alte Änderung sind korrekt. Mitgliedsentzug, Schließen und Konto-/Rollenwechsel entfernen unzulässige Sichtbarkeit. Teilnahme und Beitrag benötigen weiterhin echte Zustimmung. Keine erfundenen Teilnehmer oder Beiträge zum Erreichen eines Gruppenstatus.
- **Abhängigkeiten:** private Mitgliedschaftsmutationen und Admin-Missionserstellung müssen ebenfalls funktionieren; eine isolierte Bookmarkreparatur bei null erreichbaren Missionen liefert noch keinen nutzbaren Fluss. Das Paket bleibt nachrangig, bis diese Voraussetzungen verantwortbar geprüft werden können.
- **Abschlussgrenze:** bestehende Missionsregeln unverändert; keine Behauptung „Kooperation abgeschlossen“, bevor die tatsächlichen vorhandenen Kriterien erfüllt sind. Keine Punkte für Merken, Öffnen oder Teilnahme.

### P2-B · Ressourcen passend einordnen

**Klasse:** U2; kleiner redaktioneller/UI-**Vorschlag**, kein Backendumbau. Nach den bereits beauftragten Fehlerkorrekturen.

- **Nutzersituation:** Jemand möchte einen allgemeinen Community-/Lernleitfaden hinzufügen und findet nur technische Kategorien.
- **Gewünschtes Ergebnis:** Eine verständliche passende Einordnung ohne erzwungenes Fachgebiet.
- **Kleinster sinnvoller Scope:** genau eine freigegebene allgemeine Kategorie in den vorhandenen Create-/Filteroptionen konsistent ergänzen. Das API-Schema nimmt bereits begrenzten Kategorietext entgegen; kein neues Datenmodell nötig. Das aktuelle Editformular ändert nur Titel/URL und erhält in diesem Paket keine neue Kategorieänderung. Bestehende Einträge bleiben unverändert. [S8]
- **Abnahme:** neue Kategorie ist im Anlegeformular und Filter auswählbar; bestehende Kategorien bleiben lesbar. Kein weiterer beliebiger Inhalt nur zur Abnahme. Keine heimliche Umkategorisierung und kein Direktdatenbankeingriff für den bestehenden Eintrag.
- **Abhängigkeiten:** Entscheidung über den Kategorienamen. Keine Änderungen an URLvalidierung, Öffentlichkeit oder Berechtigungen.

### Bereits separat beauftragt · Preview-Fallback statt großem Fehlerblock

**Klasse:** U1 mit Quellenblocker T4. Kleiner laufender UI-Fix; im hier geprüften v32 noch nicht enthalten.

- **Nutzersituation/Ergebnis:** Die Quelle lässt sich lesen, obwohl ihre Vorschau fehlt. Das ist als ruhiger kompakter Zustand mit klarer Aktion verständlich.
- **Scope:** bestehender Fallback in `components/ResourcePreview.tsx`; vorhandenen sicheren Quellenlink erhalten. Keine behauptete erfolgreiche Vorschau und keine Sicherheitslockerung.
- **Abnahme:** keine irreführende Lade-/Erfolgsmeldung; Quelle per Tastatur erreichbar; lange Links und 320px-Ansicht bleiben benutzbar. Mitglieds- und Gastzustand unterscheiden, weil Preview-POST eine Anmeldung erfordert.
- **Abhängigkeit/Abgrenzung:** Ein **echter Worker-Metadatenport** ist ein späterer eigenständiger Auftrag mit gebundener DNS-/Transportprüfung, sicheren Redirect-/Zielregeln, Größen-/Zeitgrenzen und geeignetem Parser. Nicht als Teil dieses UI-Patches versprechen. [S8]

## 4. Anerkennung: vorhandenes Vertrauen zuerst abschließen

Hier zunächst **kein weiteres Oberflächenpaket** einplanen. Die heutige Basis ist bereits konkret:

- Historische Kursabschlüsse und ihre 1/3/5-Meilensteine bleiben von aktiven, widerrufbaren Kurspunkten getrennt. Punkte hängen an den bestehenden Kurs-/Quiz-/Adminfreigaberegeln.
- „Deine Hilfe wirkt“ zählt aktuelle Lösungsauswahlen unterschiedlicher berechtigter anderer Diskussionsautoren, privat und bis 5+. Das ist keine unabhängige Qualitätsprüfung, kann sinken und erzeugt weder Punkte noch öffentliche Abzeichen.
- Spark bleibt die vorhandene Figur. Sichtbarkeitseinstellung, weniger Bewegung und einmalige echte Abschlussbestätigung haben Vorrang; kein Replay beim Laden oder Kontowechsel. [S9]

**Offene Abnahme:** bei einer tatsächlich hilfreichen vorhandenen Antwort und einer freiwilligen Auswahl durch den berechtigten Autor Auswahl → sichtbare Lösung → privater Meilenstein → Rücknahme prüfen. Keine Testauswahl als vermeintliches Communitysignal ausgeben. Der v28-D1-Fix für Lösungsauswahl ist quellengeprüft; null aktuelle Auswahlen sind keine positive Mutationsabnahme. [S9]

**Explizit zurückgestellt:** allgemeine private Artikel-/Ressourcenmerker. Wenn dieser Bedarf nach Benutzung bleibt, zuerst nur diese zwei Inhaltstypen mit eigenem privatem Datenvertrag, Entfernen und einer kompakten Liste spezifizieren. Keine Umdeutung von „Meine Entwürfe“ oder Missionsmerkern in eine bereits existierende universelle Sammlung.

## 5. Verifikation vor zusätzlichen Features

- v32-Gastzustand mit einem tatsächlich verfügbaren anonymen Kontext prüfen: `/search` mit einem passenden Suchbegriff, sichtbarer Inhalts-CTA, keine Suchcontrols, Query/Typ/Page/Fragment nach Login erhalten. Die bestehende Mitgliedssitzung nicht nur für einen Screenshot verlieren.
- Space-/Missions-Reads erst mit realen berechtigten und nicht berechtigten Situationen positiv/negativ abnehmen.
- Lernpfad-Teilnahme und Umfragen als eigene technische Restarbeiten führen; nicht beiläufig im Space-/Journey-Frontendpatch „mitreparieren“.
- Benachrichtigungszustellung und unfertige Wiederaufnahme offen lassen, bis es eine echte zulässige Situation gibt. Leere Inbox und vollständig gelernter Kurs sind dafür keine Gegenbeispiele.
- Notwendige Builds/Typprüfungen vor Veröffentlichung; Funktionstests ausschließlich auf der veröffentlichten Sites-Version. Jede Änderung bleibt eigenständig prüfbar. Keine GitHub-CI-Testläufe oder sachfremden Releases.

## Quellenregister

Alle Quellpfade beziehen sich auf den oben genannten **Sites-v32-Commit**, nicht automatisch auf den Stand eines späteren GitHub-Branches. Die Browserzeiten sind vom 17.10.2026 in UTC. Dieses Dokument wurde nur aus Quellen und bereits vorhandenen veröffentlichten Beobachtungen erstellt; für die Roadmap wurden keine Produktdaten verändert oder Browseraktionen gestartet.

- **S1 · Laufzeit und Callbackgrenze:** `lib/prisma.ts`; `lib/server/space-api.ts:139–155`; installierte `@prisma/client/runtime/client.mjs:106` prüft `@prisma/adapter-d1` und verweigert interaktive Transaktionen.
- **S2 · Spacebasis:** `app/api/spaces/route.ts`; `app/api/spaces/[spaceId]/join/route.ts`; `app/api/spaces/[spaceId]/members/route.ts`; `app/api/spaces/[spaceId]/members/[userId]/route.ts`; `lib/server/space-access.ts:88–101`.
- **S3 · Diskussionen:** `lib/server/d1-space-discussion-reads.ts`; `app/api/spaces/[spaceId]/discussions/route.ts`; darunter `[discussionId]/route.ts`, `replies/route.ts` und die Moderationsrouten. Live: `/community/spaces`, 22:04:51 UTC, geprüftes Verzeichnis leer.
- **S4 · Missionen/Merken:** `lib/server/space-missions.ts:177–270,324–389`; `lib/server/space-mission-bookmarks.ts:25–112`; `lib/server/space-mission-invitation-state.ts`; `lib/server/space-mission-overview.ts`; `components/spaces/SpaceMissionDetail.tsx`; `app/community/missions/page.tsx`.
- **S5 · Getrennte Blocker:** `lib/server/space-polls.ts:115–142,198–199`; `app/api/learning-pathways/[pathwayId]/participation/route.ts:13–95`.
- **S6 · Speichermodell:** `prisma/schema.prisma:405–425` definiert private Missionsmerker; inspizierte Post-/Artikeloberflächen haben keinen allgemeinen Merker. Livebefund an Beiträgen/KB-Artikeln, kein Bookmark angelegt.
- **S7 · Wiederaufnahme:** `lib/navigation.ts`; `components/Sidebar.tsx:51–54`; `components/navigation-search.tsx:19–20`; `app/courses/journey/JourneyClient.tsx:87–170,205–262`; `journey-trail-data.ts`; `journey-progress.ts`; `app/courses/[courseId]/contents/reader-progress.ts`. Live: Kursübersicht → Lernweg, 21:51:07 UTC, alle aktuellen Stationen bestätigt.
- **S8 · Ressourcen:** `app/resources/page.tsx:55` und Adddialog; `app/api/resources/route.ts:12–18`; `components/ResourcePreview.tsx`; `app/api/resources/preview/route.ts`; `lib/server/url-security.ts:129–158,239–249`. Erneut am 17.10.2026 geprüft: [Cloudflare Workers: DNS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/) zur nicht implementierten Lookup-API. Live: einmalige Erstellung/Reload 21:53–21:54 UTC; Preview-Fallback und fünf technische Kategorien; Formularhinweis/Validation v31, 22:04:32 UTC.
- **S9 · Anerkennung:** `app/api/rewards/me/route.ts`; `lib/rewards.ts`; `components/community/PersonalProgressCard.tsx`; `lib/server/contributions.ts`; `components/community/ContributionMilestonesCard.tsx`; `lib/server/accepted-solutions.ts`; `app/courses/journey/JourneyClient.tsx:99–161`.
- **S10 · Bereits reparierte Suche/KB:** `app/search/SearchPageClient.tsx:141–204`; `components/user-nav.tsx` (`useSignInHref`); `app/knowledgebase/page.tsx`; `knowledgebase-directory-url.ts`; `app/knowledgebase/[id]/article-rich-text.module.css`. Live: v29 Typografie, v30 KB-Kontext, v32 angemeldete Suchregression 22:12–22:13 UTC.

Es werden keine Wettbewerberbehauptungen verwendet; die Reihenfolge folgt den eigenen belegten Nutzerflüssen und Datenverträgen.
