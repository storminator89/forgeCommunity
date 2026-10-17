# ForgeCommunity · Redesign vom 17. Oktober 2026

Die Oberfläche übernimmt die visuelle Richtung der gelieferten Community-, Mitglieder-, Projekte- und Events-Referenzbilder: kühler Hintergrund, weiße Karten, Petrol-Aktionen, Mint-/Blau-Banner und Linienicons. Die ursprünglichen API-Aufrufe, Autorisierungen, Validierungen und Speicherabläufe bleiben in ihren vorhandenen Komponenten.

## Vollständige Seitengestaltung

Die Erweiterung erfasst alle 49 Seitenrouten: 47 darstellende Seiten und zwei Weiterleitungen. Wissensdatenbank, Entwürfe, Skills, Profile, Einstellungen, Benachrichtigungen, Suche, Spaces/Missionen, Chat, Kurslernen und -autorenschaft, Administration, Moderation sowie öffentliche und Authentifizierungsseiten verwenden jetzt dasselbe System. Die Seitentypen behalten ihre jeweilige Struktur: Kalender, Feed, Verzeichnis, Lesefläche, Formular, Tabelle oder Arbeitsplatz.

- [Vollständige Routen- und Komponentenliste](page-coverage.md), [maschinenlesbar](page-coverage.json)
- [Kontaktbogen aller Desktop-Seiten](all-pages-desktop-contact-sheet.jpg)
- [Events mit befüllten Testdaten](after-events-1440.png), [Smartphone](after-events-Monat-light-375.png)
- [Events: Layout- und Filterprüfung](events-layout-results.json)

Events übernimmt den breiten Mint-/Blau-Kopf, Monats-/Wochen-/Listenwahl, Suche, Kategorieauswahl, anstehende Termine und die rechte Filter-/Hilfsspalte. Die Kategorieauswahlen sind synchronisiert, der Zeitraum berücksichtigt die Event-Zeitzone, vergangene Termine sind mit entsprechendem Filter auch in der Liste sichtbar. Der bestehende Einzeltermin-ICS-Download bleibt verwendbar; ein nicht vorhandener Abo-Endpunkt wird nicht vorgetäuscht.

Die vollständigen Routentests laufen mit echten Wegwerfkonten in `/tmp/forge-every-page-qa/forge-browser-qa.db`. Für ausgewählte Artikel-, Projekt-, Ressourcen- und Kursansichten liefern sie zusätzliche synthetische API-Antworten. Die Datenbank der laufenden Benutzeranwendung bleibt unberührt. Jeder darstellende Pfad prüft eine fertig geladene Ansicht, Überschrift, Theme, Überlauf und den Tastatur-Sprunglink; die Weiterleitungen werden separat geprüft.

Das ursprüngliche Logo ist bytegleich mit dem Git-Ausgangsstand. Die eigenen einfarbigen Konturicons bleiben eingebunden.

## Erste Referenzrunde: acht Ansichten

| Ansicht | Vorher · Desktop | Nachher · Desktop | Nachher · Smartphone |
| --- | --- | --- | --- |
| Community | [Vorher](before-community-1440.png) | [Nachher](after-community-light-1440.png) | [390 px](after-community-light-390.png) |
| Mitglieder | [Vorher](before-members-1440.png) | [Nachher](after-members-inspector-1440.png) | [390 px](after-members-light-390.png) |
| Projekte | [Vorher](before-projects-1440.png) | [Nachher](after-projects-light-1440.png) | [390 px](after-projects-light-390.png) |
| Kurse | [Vorher](before-courses-1440.png) | [Nachher](after-courses-light-1440.png) | [390 px](after-courses-light-390.png) |
| Ressourcen | [Vorher](before-resources-1440.png) | [Nachher](after-resources-light-1440.png) | [390 px](after-resources-light-390.png) |
| Kursentwurf | [Vorher](before-course-new-1440.png) | [Nachher](after-course-new-light-1440.png) | [390 px](after-course-new-light-390.png) |
| Artikel erstellen | [Vorher](before-article-new-1440.png) | [Nachher](after-article-new-light-1440.png) | [390 px](after-article-new-light-390.png) |
| Projektdetail | [Vorher](before-project-detail-1440.png) | [Nachher](after-project-detail-light-1440.png) | [390 px](after-project-detail-light-390.png) |

Die entsprechenden `after-…-dark-1440.png` und `after-…-dark-390.png` zeigen den Dark Mode. Die Vorher-Aufnahmen stammen aus dem ursprünglichen Git-Stand in einer separaten temporären Kopie. Die Nachher-Aufnahmen stammen aus der lokal laufenden Anwendung; zusätzlich wurde das gebaute Produktionsfrontend geprüft.

In dieser ersten Runde mit acht Ansichten sind alle gezeigten Namen, Beiträge, Projekte, Kurse und Zähler isolierte Rendering-Testdaten. Die Browserprüfung hat API-Antworten abgefangen und keine Datenbankinhalte angelegt, bearbeitet oder gelöscht. Die Screenshots belegen die Darstellung und ausgewählte UI-Interaktionen; sie ersetzen keinen vollständigen Test aller serverseitigen Workflows mit echten Konten.

## Gemeinsame Bausteine

- `components/discovery.tsx`: `HeroBanner`, `PageContainer`, `SurfaceCard` und eine originale dekorative SVG-Landschaft für die Community.
- `app/globals.css` und `tokens.css`: semantische Farben, Karten, Filter, Radien, Abstände und responsive Layouts. Die vorhandenen HSL- und Tailwind-Verträge bleiben erhalten.
- `Sidebar`, `NavigationSearch`, `ForgeBrandMark`: eigene, mit ImageGen erstellte einfarbige Konturicons und das unveränderte ursprüngliche Bildlogo; vorhandene Rollensichtbarkeit, Suchdialog und einklappbare Navigation.
- Bestehende Buttons, Eingaben, Auswahlfelder, ThemeToggle und Rich-Text-Editor: gemeinsame Flächen und Zustände.
- Mitglieder: optionale Vorschau mit den bereits geladenen öffentlichen Feldern. Schließen gibt den Tastaturfokus zurück; ein ausgefiltertes Profil verschwindet aus der Vorschau.
- Kursentwurf: vier nummerierte Formularabschnitte und eine Hilfsspalte. Das Kursbild wird weiterhin nach dem Anlegen des Entwurfs im Autorenbereich hochgeladen.

## Verifikation

| Prüfung | Ergebnis |
| --- | --- |
| `npm run typecheck` | erfolgreich |
| `npm run lint` | erfolgreich |
| `npm run test:styles` | erfolgreich, einschließlich semantischer Kontrastpaare |
| `npm test -- --runInBand --silent` | 258 Testdateien erfolgreich; 2.848 Tests bestanden, 5 übersprungen |
| `npm run build` | erfolgreicher Produktionsbuild einschließlich Standalone-Vorbereitung |
| Produktionsfrontend · Layout | 8 Ansichten × 7 Breiten × 2 Themes = 112 Prüfungen; kein horizontaler Überlauf in Dokument oder Hauptinhalt |
| Getestete Breiten | 320, 375, 390, 414, 768, 1280, 1440 px |
| Produktionsfrontend · Interaktionen | Theme-Menü, mobiler Navigationsdrawer, Fokus-Rückgabe, Profilvorschau, Mitglieder-/Projektsuche und Listenumschaltung erfolgreich |
| Browserfehler im Renderinglauf | keine |
| `git diff --check` | erfolgreich |

[Layout-Ergebnisse als JSON](layout-results.json)

Die veralteten Tests für Bildicons und die bisherige Feed-Anordnung wurden an die neue Gestaltung angepasst. Die Prüfungen für Rollen, Navigation, echte Datenanzeige, Speicherfehler und Belohnungsbedingungen bleiben bestehen. Ein neuer Verhaltenstest prüft die Mitglieder-Vorschau einschließlich Fokus-Rückgabe und ausgefiltertem Profil.

## Mögliche weitere UX-Arbeit

- Nutzertests mit langen echten Kursen, Artikeln und Profiltexten.
- Vertiefte manuelle Screenreader-Prüfung der gesamten Anwendung.

## Korrektur: Original-Logo und eigenes Icon-Set

Das ursprüngliche Logo wurde auf ausdrücklichen Wunsch wiederhergestellt. Die Navigation verwendet nun 20 eigens generierte transparente Kontur-Assets, als kleine einfarbige CSS-Masken. Die Schriftfarbe bestimmt den sichtbaren Icon-Farbton; aktive Menüpunkte und Dark Mode folgen den vorhandenen Theme-Tokens. Einzelquellen, exakte Prompts und Exportanleitung liegen in `assets/source/navigation-outline/individual/` sowie der dortigen übergeordneten README.

Nach der Logo-/Icon-Korrektur: 35 gezielte Tests für Asset-Zuordnung, Original-Logo, Rollensichtbarkeit, mobile und eingeklappte Navigation sowie Schnellsuche bestanden. Zusätzlich wurden Style-/Kontrastprüfung, Typecheck, Lint und Browserdarstellung geprüft. Der Windows-Kontrastmodus wurde eigens auf sichtbare Masken mit Systemschriftfarbe geprüft.

## Einzelicons und korrigierter Export

Alle 20 Navigationssymbole wurden jeweils in einem eigenen ImageGen-Aufruf neu erstellt. Der frühere Export hatte nichtquadratische Konturen durch die Standard-Skalierung mit `cover` beschnitten. Der neue Export verwendet ausdrücklich `contain`, einen zusätzlichen Rand um die sichtbare Kontur und 8px transparente Ausgabe-Ränder. Ein Regressionstest prüft die erhaltenen Seitenverhältnisse der Silhouetten. Die Sidebar zeigt die vollständigen Symbole mit leicht verstärkter Kontur; das ursprüngliche Logo bleibt unverändert.

Quellen und exakte Prompts: `assets/source/navigation-outline/individual/`. Eingebundene Dateien: `public/images/navigation/outline-v2/`. Diese eigenen URLs verhindern, dass der Browser noch die alten Ausschnitte verwendet.

[Neue Sidebar, Hell](sidebar-individual-light-2x.png) · [Dunkel](sidebar-individual-dark-2x.png) · [Vorschau der 20 separat erzeugten Dateien](navigation-individual-preview.png)

Der Artikelentwurf behält eine kompakte Aktionsleiste. Auf 320px passen die üblichen Editorwerkzeuge in zwei Reihen; Titel, Kategorie und die erste Textzeile sind beim Öffnen sichtbar. Speichern und Veröffentlichen behalten ihre ursprünglichen getrennten Abläufe.

## Abschließende Verifikation

| Prüfung | Ergebnis |
| --- | --- |
| Gesamte Jest-Suite | 258 Dateien bestanden; 2.850 Tests bestanden, fünf übersprungen |
| Vollständige Seitengestaltung | 49 Routen bei 320, 375, 414, 768 und 1280px; 480 Browserfälle bestanden |
| Nach finaler Icon-Korrektur | Alle Routen erneut bei Desktop und 320px geprüft: 192 Fälle bestanden |
| Befüllte Arbeitsplätze und Desktop-Navigation | Acht Browserfälle bestanden, einschließlich Artikelbearbeitung, Kursveröffentlichung und Übungen |
| Mobile Navigation | Zwei Fälle bestanden: Hell/Dunkel, Drawer, Fokus-Rückgabe und Schnellsuche |
| Befüllte Events | 36 Layoutfälle ohne Überlauf in Dokument/Hauptinhalt; Kategorien, Zeitraum und Listenfilter bestanden |
| Ergänzende Übersicht-/Formularansichten | 112 Layoutfälle bei sieben Breiten und zwei Themes bestanden |
| Lint, TypeScript und Stil-/Kontrastprüfungen | bestanden |
| Produktionsbuild | bestanden |
| Logo | bytegleich mit dem ursprünglichen Git-Stand |

Die zusätzlichen 375-/414-/768px-Routenprüfungen stammen aus der Seitengestaltung vor der letzten Icon-Korrektur; die finalen Icon-Dateien wurden zusätzlich in Desktop-, mobiler, eingeklappter Navigation und Schnellsuche geprüft. Die Kalender-Zellen begrenzen ihre unsichtbaren Beschriftungen innerhalb des horizontalen Kalender-Scrollbereichs.

[Maschinenlesbare Prüfergebnisse](verification.json)
