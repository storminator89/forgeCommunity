# Kurseditor: Lernpfad und Inhaltspflege

Der Kurseditor trennt gespeicherte Inhalte von lokalen Entwürfen. Kapitel, Themen und Unterthemen werden in einem rekursiven Inhaltsverzeichnis gepflegt. Die Bearbeitungsrechte stammen aus der Kurs-API; Lernende erhalten eine Leseansicht.

## Autorenarbeitsplatz

- Kursverantwortliche öffnen standardmäßig **Bearbeiten**. Die nummerierte Kursstruktur bündelt Kapitel und verschachtelte Inhalte. Hinzufügen fragt zuerst nach Titel und Inhaltstyp und führt danach direkt zum neuen Inhalt.
- Der Bereich **Lernpfad im Kurs** zeigt die aktuelle Reihenfolge, die Inhalte ohne Unterthemen und konkrete Pflegehinweise. **Kurs prüfen** bewertet den gespeicherten Stand und verlinkt zu betroffenen Inhalten. Beides ist Orientierung, kein Veröffentlichungs- oder Abschluss-Gate.
- **Vorschau** durchläuft den Kurs einschließlich lokaler ungespeicherter Änderungen. Antworten in der interaktiven Quizvorschau erzeugen weder Versuche noch Fortschritt oder Zertifikate. **Lernen** zeigt den gespeicherten Kursinhalt und muss ausdrücklich gewählt werden.
- Der Quizeditor führt Fragen nach Typ durch die passenden Felder und prüft sie vor dem Speichern. Unterstützt sind Einfach- und Mehrfachauswahl, Wahr/Falsch, Kurzantwort, Lückentext und Zuordnung. Die lokale Quizvorschau ermöglicht das Ausprobieren ohne Bewertung oder Schreibaktion.
- **Anlegen** und **Speichern** machen Inhalte sofort für eingeschriebene Lernende sichtbar. Es gibt in dieser Ausbaustufe keinen Entwurfsstatus, Freigabeknopf oder versionierten Veröffentlichungsvorgang. Ungespeicherte Änderungen bleiben nur lokal und werden beim Verlassen geschützt.

## Behobene Fehler

| Ablauf | Vorher | Jetzt |
| --- | --- | --- |
| Abbrechen | Titel/Inhalt änderten bereits den sichtbaren Kursbaum. | Entwurf bleibt getrennt; Verwerfen verändert gespeicherte Daten nicht. |
| Speichern eines Kapitels | Die lokale Antwort ersetzte den Elternknoten und verlor dessen Kinder. | Der Unterbaum bleibt erhalten, auch bei mehreren Ebenen. |
| Fehlgeschlagene Aktionen | Fehler wurden verschluckt, Dialoge geschlossen oder Zeilen voreilig entfernt. | Eingaben und Dialoge bleiben erhalten; Speichern/Löschen lassen sich wiederholen. |
| Umbenennen | Enter und Blur konnten doppelt speichern; tiefe Themen wurden nicht aktualisiert. | Explizites Speichern, Abbrechen und Escape; ein Request, rekursive Aktualisierung. |
| Sortieren | Falsche Callback-ID; identische Rangwerte; unabhängige PUTs mit möglichen Teiländerungen. | Richtige Parent-/Child-ID, atomare Reihenfolge, auch für Hauptkapitel. |
| Verschieben | Keine verlässliche Aktion für Tastatur und Touch. | Zielauswahl mit Unterbaum; eigene Nachfahren sind ausgeschlossen, die API verhindert Zyklen. |
| Inhaltstyp wechseln | Wechsel löschte den bisherigen Entwurf. | Pro Typ bleibt der Entwurf bis zum Speichern/Verwerfen erhalten. |
| Quiz bearbeiten | String-/Objektformate, Vorschau und Antwortindizes waren inkonsistent. | Gemeinsamer Legacy-Parser, direkte Formularänderungen, Vorschau ohne Speichern und korrekte Antwortzuordnung. |
| Medien | Queryparameter wurden HTML-kodiert; H5P-Quellen gingen verloren. | Sichere Quellen bleiben erhalten; Anbieter-Links werden in passende Player-URLs übersetzt. |
| Leerer Text | Editor-Normalisierung erzeugte ohne Eingabe eine Änderung. | Leere Absätze gelten als unverändert. |

## Bedienung

- Neue Kapitel und Themen öffnen direkt die Inhaltspflege. Titel, Text, Video, Audio, H5P und Quiz verwenden ein gemeinsames Formular.
- Das aktuell ausgewählte Thema bleibt über `?content=…` nach dem Neuladen erreichbar.
- Themenwechsel, Abbrechen und interne Links schützen ungespeicherte Änderungen. Beim vollständigen Verlassen greift die Browserwarnung.
- Speichern blockiert Doppelanfragen. Strukturaktionen werden während laufender Mutationen gesperrt.
- API-Schreibaktionen prüfen Berechtigung und Kurszugehörigkeit innerhalb einer serialisierbaren Transaktion. Konflikte lassen sich wiederholen; bei erfolgloser Wiederholung antwortet die API mit 409.
- Quiz-Inhalte bleiben kompatibel mit der bestehenden Datenbank: Darstellung `QUIZ`, Speicherung weiterhin als `TEXT` mit JSON. Es ist keine Schemaänderung oder Datenmigration nötig.
- Auch verwaiste oder zyklische Altbestände bleiben in der Leseansicht sichtbar; neue ungültige Hierarchien werden verhindert.

## Prüfung und Grenzen

Die lokale Komponenten-, API- und Integrationsprüfung des integrierten LMS-Editors bestand vor dem ergänzten Browserfall mit 148 Testsuiten und 1.229 Tests. ESLint, Typprüfung und Stilprüfungen bestanden. Der neue Browserfall ist für eine isolierte synthetische SQLite-Datenbank und einen Loopback-Server abgesichert; er prüft die echte Autorenreise am Desktop und bei 320 px, wurde für diesen Stand aber noch nicht in CI ausgeführt. Produktionsbuild, PostgreSQL und die endgültige Browserprüfung sind bis zum PR-Lauf offen. Die Ergebnisse werden hier erst nach dem Lauf auf einen konkreten Commit bezogen ergänzt.

Die Vorschau prüft keine tatsächliche Wiedergabe externer Video-, Audio- oder H5P-Quellen; diese benötigen erreichbare Quellen. Die unveränderte Lern- und Zertifikatslogik wird nicht durch die Autoren-Vorschau ersetzt.

## Frühere Ansichten

Diese Bilder zeigen den bereits geprüften früheren Kurseditor. Neue Screenshots des Autorenarbeitsplatzes werden erst aus einer erfolgreich ausgeführten Browserprüfung des veröffentlichten Stands übernommen.

![Kurseditor und Quiz, Desktop](ui/course-editor-desktop.png)

![Kurseditor und Quiz, Mobil](ui/course-editor-mobile.png)
