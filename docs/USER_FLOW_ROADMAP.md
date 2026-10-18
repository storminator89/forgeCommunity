# ForgeCommunity Nutzerflüsse und nächste Schritte

Stand: 18. Oktober 2026, 04:33 UTC · veröffentlichte Sites-Version **v63**  
Quellstand: `7a2909d82f1f419a8d19cea73d1395e291deb8f0`  
Produkt: [ForgeCommunity](https://forge-community.dsgvision.chatgpt.site)

Dieses Dokument beschreibt die veröffentlichte Sites-Variante und ihre gezielten Live-Prüfungen. Das Standardsetup mit Docker und SQLite oder PostgreSQL bleibt in der README der Hauptversion dokumentiert. Cloudflare-Einrichtung und Laufzeitgrenzen stehen separat in [CLOUDFLARE_SITES.md](CLOUDFLARE_SITES.md).

## Kurzentscheidung

Die bisherige pauschale Missions- und Umfrageblockade ist überholt: Die vorhandenen Umfrageoperationen und große Teile des privaten Missionsflusses haben inzwischen native D1-Pfade. Sie sind ausgeliefert, aber ihre komplexen positiven Fachfälle sind ohne passende legitime Situationen noch nicht live abgenommen. Ein fertiger durchgängiger Missions- oder Einladungsfluss wird deshalb nicht behauptet.

Als nächste Schritte bleiben die positive Abnahme vorhandener Einladungsentscheidungen, passende weitere Fachabnahmen und der sichere Ressourcen-Metadatenport. Keine neuen Oberflächen, Punkte oder künstlichen Teilnehmer zum Füllen leerer Menüs.

## Was der Status bedeutet

- **Ausgeliefert:** im genannten veröffentlichten Quellstand enthalten; technische Quellprüfung und Build ersetzen keine Funktionsabnahme.
- **Live bestätigt:** nur der ausdrücklich beschriebene Teilfluss wurde auf der veröffentlichten Website beobachtet.
- **Abnahme offen:** die passende reale Situation oder gezielte veröffentlichte Prüfung fehlt.
- **Quellenblocker:** ein konkreter bestehender Aufrufpfad ist mit der eingesetzten Laufzeit inkompatibel. Das ist kein neuer beobachteter Browserfehler.

Leere Listen und eine leere Inbox beweisen keinen positiven Schreib-, Zustellungs- oder Berechtigungsfluss. Die bisherigen gezielten Desktopprüfungen sind keine vollständige Barrierefreiheits-, Geräte-, Rollen-, Sicherheits- oder Parallelitätsabnahme.

## Ausgelieferter Funktionsstand

| Bereich | Auf Sites ausgeliefert | Aussagegrenze |
| --- | --- | --- |
| Lernen und Finden | Persönlicher Fortschritt; aktueller Kursstationenpfad; USER-Zugang zu „Mein Lernweg“ über Navigation, Schnellsuche und persönliches Menü; berechtigte Kursauswahl in der URL. Wissensdatenbank, Projekte, Ressourcen und Mitglieder haben URL-gebundene vorhandene Such-/Filter-/Sortzustände. | Begrenzte Einzelkurs- und Verzeichnisflüsse live bestätigt; Mehrkurswechsel, echte unfertige Wiederaufnahme und weitere Grenzfälle offen. |
| Lernpfad-Definition | Seit v63 native ADMIN-Erstellung bestehender Lernpfaddefinitionen mit zwei bis vier geordneten Kurssnapshots, Versiegelung und exaktem unveränderlichem UUID-Beleg für Wiederholung. | Keine neue Kursfreigabe, Belohnung oder Teilnahme. Positive Admin-Erstellung, Wiederholung, Material-/Reihenfolge-, Parallelitäts- und Rollbackfälle offen. Drei vollständige Versuche statt zuvor vier; die getrennte Verfügbarkeitsabfrage kann weiterhin nach gespeichertem Commit mit 500 scheitern. |
| Lernpfad-Teilnahme | Seit v62 native D1-Teilnahme POST/DELETE für berechtigte reguläre USER, mit vollständigem eigenen Abgleich privater Lernpfadabzeichen und erhaltener Teilnahme-/Änderungshistorie. | Kein neues öffentliches Abzeichen, keine Kursbelohnung oder Kurseinschreibung. Positive erste/erneute Teilnahme, Verlassen, pfadübergreifende Abzeichen-/Historien-, Rollen-, Verfügbarkeits-, Datenschutz- und Parallelitätsfälle bleiben offen. „Mein Lernweg“ ist eine eigene, bereits vorhandene Funktion. |
| Lesen und Bearbeiten | Richtexttypografie für Wissensartikel; breiter Projekttitel mit separater Aktionszeile; Ressourcenformular mit Öffentlichkeitshinweis; Pending-/Snapshot-/Fehlerdraftschutz für Projekt- und Ressourcenbearbeitung; vorhandener Richtexteditor und Rückkehrfokus in diesen Dialogen. | Lesen, Öffnen/Schließen, Pflichtfeldvalidierung und jeweiliger Rückkehrfokus gezielt geprüft. Keine gültigen Bearbeitungs-PUTs zur Prüfung von Pending-, Retry-, Datei- oder Kontowechselrennen ausgeführt. |
| Projektkommentare | Schutz neuerer Eingaben bei verspätetem Erfolg; sichere explizite HTTP(S)-Textlinks; newline-erhaltender Sanitizer für neue Kommentare. | Ein freigegebener Kommentar gespeichert und nach Reload vorhanden. Vorhandener Link mit korrektem HTTPS-Ziel, Neutabhinweis, Schutzattributen und sichtbarem Tastaturfokus geprüft; das externe Ziel wurde nicht durch Linkaktivierung geöffnet. Weitertext während Pending und neue mehrzeilige Persistenz bleiben quellengeprüft. |
| Spacebasis und Diskussionen | Space-Erstellung für PUBLIC/PRIVATE; eigene PUBLIC-Mitgliedschaft; geschützte Diskussions-/Antwortreads und -erstellung; seit v61 native ADMIN-Moderation zum Verbergen/Wiederherstellen vorhandener Diskussionen und Antworten. | Positiver Erstellen/Beitreten/Schreiben/Antworten-Fluss mit einem wirklich benötigten Space noch offen. Positive Moderation, verborgene Eltern, unveränderter Status, Datums-/Rollen-/Parallelitäts- und Rollbackfälle sind nicht live abgenommen. |
| Umfragen | Native D1-Liste/Detail, Erstellen, eigene Stimmabgabe mit Revision/Receipts sowie Schließen und Verbergen/Wiederherstellen. | Seit v45–v48 ausgeliefert. Positive Erstellen-/Vote-/Moderations-, Quoten-, Replay-, Paging-, Datenschutz- und Parallelitätsfälle nicht live abgenommen. |
| Private Missionen | Native D1-Erstellung mit bestehendem Wochenvertrag, Schließen mit gekoppelter Bereinigung, normale eigene Teilnahme/Verlassen, eigene Beiträge/Rücknahme und Beitragsmoderation. | Seit v49–v53 ausgeliefert. Echte Zustimmung, Kapazität, Fristen, Beitragshistorie, Zugriffsentzug und Rennen benötigen passende veröffentlichte Abnahme. |
| Missionsmerker und privater Zugang | Native D1-Merker-PUT sowie private Mitgliederaufnahme/-entfernung mit gekoppeltem Einladungs-, Merker- und Teilnahmewiderruf. | Seit v54/v55 ausgeliefert. Kein allgemeiner Artikel-/Ressourcenmerker; positive private Änderungs- und Widerrufsfälle offen. |
| Missionseinladungen | Native D1-Detail-/Benachrichtigungszielauflösung, Kandidatensuche, Empfangspräferenz, Senden und seit v60 Annehmen/Ablehnen mit gekoppelter Teilnahme, Bereinigung und Vertragsgrenzen. | Seit v56–v60 ausgeliefert. Positive Zustellung, Annahme/Ablehnung, Replay, Unterdrückung, Quoten, Ablauf, Datenschutz und Rennen offen. Kein durchgängiger Einladungsfluss live abgenommen. |
| Ressourcen-Vorschau | Kompakter neutraler Fallback und bestehender sicherer Quellenlink. | Fallback und Tastaturzugang zur Quelle live bestätigt. Der echte externe Metadatenabruf bleibt technisch blockiert. |

Die nachfolgenden Ports erweitern die Laufzeitkompatibilität vorhandener Funktionen. Sie führen keine neue Bewertung, Missionsregel, Rangliste oder Belohnung ein.

## Tatsächlich bestätigte Live-Teilflüsse

- **Lernweg:** ein vorhandener abgeschlossener Einzelkurs, Stationen und Leserlinks; USER-Navigation/Schnellsuche/persönliches Menü; korrekte Aktivmarkierung, Kursquery, Reload und beobachteter Teil-Link. Kein zweiter Kurs, kein echter unfertiger Wiederaufnahmefall und keine zusätzlich geprüfte Staffvariante.
- **Wissensdatenbank:** ein sinnvoller Artikel veröffentlicht und wiedergefunden; Überschriften/Listen/Links lesbar. Suche/Kategorie → Detail → Zurück/Vorwärts, Reload, beobachteter Teil-Link und Resetfokus bestätigt. Eigene Tag- und manipulierte URL-Fälle offen.
- **Projekte/Ressourcen:** je ein freigegebener echter Inhalt gespeichert und nach Reload gelesen. Die beobachteten Such-/Sort- beziehungsweise Such-/Kategorieflüsse erhalten nach Detail → Zurück, Reload und Teil-Link ihren Kontext. Reset fokussiert Suche. Weitere Tags, Typ-/Sortkombinationen und größere Datenmengen bleiben offen.
- **Mitglieder:** Suche plus vorhandener Rollenfilter und Datum-absteigend → eigenes Profil → Zurück/Reload erhält denselben Treffer. Reset entfernt Suche/Rolle und fokussiert das Suchfeld; Sortierung bleibt erhalten. Skillfilter und vollständige Vorwärtsserie offen.
- **Bearbeiten:** vorhandene Projektbeschreibung wird als Richtext mit erhaltenen Absätzen geöffnet. Projekt-Cancel/Escape führt zum Bearbeiten-Button zurück; Ressourcen-Cancel/Escape zum ursprünglichen Aktionen-Trigger. Keine Änderung nur zur Abnahme gesendet.
- **v61-Regressionsgrenze:** am 18. Oktober um 03:56 UTC blieben Session und leere Missions-/Spaceübersichten ohne sichtbaren Fehler erhalten. Es erfolgte keine Moderation oder Datenänderung; dies ist keine positive Moderationsabnahme.
- **v62-Regressionsgrenze:** am 18. Oktober um 04:16 UTC blieben Session und leere Space-/Lernpfadübersichten ohne sichtbaren Fehler erhalten. Keine Teilnahme-, Abzeichen-, Belohnungs- oder Datenaktion erfolgte. Die leere Liste beweist keinen positiven Teilnahmefluss.
- **v63-Regressionsgrenze:** am 18. Oktober um 04:33 UTC blieben Session und nach Reload vollständig geladene leere Lernpfadübersicht ohne sichtbaren Fehler erhalten. Keine Definition, Freigabe, Belohnung oder sonstige Datenaktion erfolgte; positive Admin-Erstellung bleibt ungeprüft.
- **Geschützte leere Übersichten:** begrenzte Listen-/Inbox-Regressionsprüfungen sind von den weiterhin fehlenden positiven Space-, Umfrage-, Missions- und Einladungsfällen getrennt. Keine zusätzlichen Teilnehmer, Stimmen oder Einladungen als Prüfmaterial erzeugt.

Gast-/Loginrückkehr, vollständige Geräte-/Assistenztechnikabnahme, Benachrichtigungszustellung und seltene Fehlerzustände sind damit nicht allgemein bestätigt. Detaillierte Laufzeitabgrenzungen stehen im separaten Cloudflare-Guide.

## Verbleibende Abnahmegrenzen und konkrete Quellenblocker

1. **Positive Einladungsabnahme:** Annehmen/Ablehnen ist seit v60 nativ ausgeliefert, einschließlich gekoppelter Teilnahme, Frist-/Revisions-/Zugriffskontrolle und terminaler Bereinigung. Die begrenzte veröffentlichte Regression bestätigte nur erhaltene Session und leere Benachrichtigungs-/Missionsübersichten ohne sichtbare Fehler. Positive Annahme/Ablehnung, Wiederholung, Ablauf, Kapazität, Datenschutz und Rennen bleiben ohne legitime autorisierte Einladung offen. Das ist eine Abnahmegrenze, kein weiter bestehender Decision-Callbackblocker.
2. **Weitere Abnahmegrenzen und Restpfade:** Admin-Lernpfaddefinition-Erstellung ist seit v63 nativ ausgeliefert; die positive Fachabnahme bleibt offen. Der Create-only-Port beansprucht keine umfassende Admin-Bearbeitung. Drei vollständige native Versuche und ein dauerhafter Beleg nach beobachteter UUID-Belegung ersetzen den früheren Vier-Versuche-Pfad; Verfügbarkeits-/Antwortfehler nach Commit sind weiterhin möglich. Die normale Lernpfad-Teilnahme POST/DELETE ist seit v62 nativ ausgeliefert; positive Teilnahme-/Abzeichen-/Historienabnahme bleibt offen. Vollständiger eigener Abgleich, erhaltene Historie und Opt-out-Datensätze bleiben Teil des Vertrags. Native Ressourcen-, Datums-, Int32- und Versionsgrenzen gelten; die tatsächliche Installation zusätzlicher Datenbanktrigger wurde nicht live geprüft. Diskussions-/Antwortmoderation ist seit v61 nativ ausgeliefert; die positive Fachabnahme bleibt offen. Der Port bewahrt begrenzte native Zeilen-/Antwortbudgets und unterstützte absolute Datumsformen; beliebige fehlerhafte oder übergroße Altdaten sind nicht allgemein gleichwertig unterstützt. Auch andere Account-/Rollen-/Melde- und Kursfunktionen sind durch die genannten Ports nicht pauschal repariert. „Mein Lernweg“ ist nicht die Lernpfadteilnahme.
3. **Ressourcen-Metadaten:** `lib/server/url-security.ts` verwendet weiterhin `lookup()` aus `dns/promises`. Die [Cloudflare-DNS-Dokumentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/) führt diese Funktion als nicht implementiert. Quellenableitung: der bestehende Hostnamepfad scheitert vor dem Domainabruf und bleibt geschlossen. Der Fallback repariert den Transport nicht; eine spezielle Sperre der externen Website ist nicht belegt.

## Die nächsten drei begrenzten Pakete

### 1 Ausgelieferte Einladungsentscheidungen positiv abnehmen

Eine berechtigte empfangende Person kann seit v60 den vorhandenen nativen Decision-Pfad verwenden. Für die Abnahme braucht es eine legitime freiwillige Situation für Annahme/Ablehnung, Wiederholung, Ablauf und Zugriffsentzug. Kein neues Einladungs-UI, keine stillschweigende Zustimmung und kein zusätzlicher Code ohne konkreten Befund. Ohne passende autorisierte Einladung bleibt die positive Live-Abnahme offen.

### 2 Vorhandene Zusammenarbeit positiv abnehmen

Mit einem wirklich benötigten Space und passenden berechtigten Rollen zunächst den öffentlichen Kernfluss, danach eine tatsächlich benötigte Umfrage beziehungsweise private Mission gezielt prüfen. Kein neuer Code ohne konkreten Befund. Abnahme umfasst gespeicherten Inhalt nach Reload, echte freiwillige Teilnahme, korrekt begrenzte eigene Änderungen und Verlust unzulässiger Sichtbarkeit nach Widerruf. Adminzugang, Zweck und ausdrücklich erlaubte Inhalte sind Voraussetzungen; leere Übersichten ersetzen sie nicht. Seltene Parallelitäts-, Replay- und Quotenfälle bleiben getrennt zu beurteilen.

### 3 Metadatenabruf sicher portieren

Den bestehenden Preview-Abruf für die Worker-Laufzeit begrenzen: DNS-/Transportbindung, Redirect-/Zielprüfung, Größen-/Zeitgrenzen und geeigneter Parser müssen zusammenpassen. Keine URLvalidierungslockerung oder beiläufige Host-/Dienständerung. Mit einer passenden freigegebenen öffentlichen Quelle echte Metadaten lesen und unzulässige/nicht verfügbare Ziele geschlossen halten. Wenn der sichere Port innerhalb des bestehenden Hostings nicht tragfähig ist, den funktionierenden Quellen-Fallback beibehalten und die Grenze benennen.

## Anerkennung und spätere Produktentscheidungen

Historische unterschiedliche Kursabschlüsse bleiben von aktiven widerrufbaren Kurspunkten getrennt. Ein Abschluss garantiert keine Punkte oder Zertifikatsausgabe. Private Hilfreichkeitsanerkennung zählt aktuelle freiwillige Lösungsauswahlen verschiedener berechtigter anderer Autoren, ist reversibel und erzeugt keine neue Mission-XP, öffentliche Abzeichen oder Streaks. Positive Auswahl/Rücknahme ist ohne passende echte Situation weiterhin offen. Vorhandene Spark-Sichtbarkeits- und Bewegungsoptionen erhalten.

Eine allgemeine private Inhaltsmerkliste und eine passendere allgemeine Ressourcenkategorie bleiben nachrangige Produktvorschläge. Missionsmerker sind keine bereits vorhandene universelle Sammlung. Leere Lernziele, Ranglisten oder Menüs sind kein Anlass für künstliche Aktivität.

## Quellen und Prüfgrenze

Grundlage: der oben genannte v63-Quellstand, bestätigte Auslieferungen bis v63 und die ausdrücklich abgegrenzten veröffentlichten Beobachtungen. Für diese Dokumentprüfung wurden keine Produktdaten oder Repositorydateien verändert, keine Funktionstests gestartet und keine Browseraktionen ausgeführt.

Wesentliche Quellverträge: `space-polls.ts`, `space-missions.ts`, `space-mission-bookmarks.ts`, `space-mission-invitations.ts` und ihre nativen D1-Helper unter `lib/server/`; private Mitgliedschaftsrouten; Lernpfadteilnahmeroute; `lib/server/url-security.ts`; Journey-/Verzeichnis-URLhelper und vorhandene Bearbeitungs-/Kommentaransichten. Standard-Node/Docker und Sites/D1 bleiben getrennte Laufzeitziele. Kein vollständiger Funktions-, Sicherheits- oder Barrierefreiheitsnachweis wird daraus abgeleitet.
