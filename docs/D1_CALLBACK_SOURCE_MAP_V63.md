# D1-Callback-Quellenkarte: historische Version 63

Inventurbasis: veröffentlichte **v63**, Quellstand `7a2909d82f1f419a8d19cea73d1395e291deb8f0`.
Diese kompakte, kuratierte Quellenkarte dokumentiert statisch erreichbare Aufrufzweige. **63 Routen-/Methodenzweige sind keine 63 live beobachteten Fehler und keine 63 unabhängigen Nutzerabläufe.** Frühere Session-, Rollen-, Daten- oder Tokenbedingungen können den jeweiligen Aufruf verhindern. Hieraus folgt keine Funktionsabnahme anderer Pfade.

## Fortschritt seit der Inventur

Seit **v64**, Quellstand `f4b25418f0f52bd882cc1a4db2d1d6d2d2c02faf`, ist genau der frühere Follow-POST-Callback durch [d1-user-follow.ts](../lib/server/d1-user-follow.ts) und den vorhandenen [Follow-Routendelegaten](../app/api/users/%5Bid%5D/follow/route.ts) portiert. Die historische v63-Zählung bleibt unverändert. Positive Follow-/Benachrichtigungsabnahme ist weiter offen. Diese Ergänzung ist keine neue Gesamtinventur oder pauschale Fehlerfreiheitserklärung.

Seit **v65**, Quellstand `4ec1307381f075814aff1d207bb3d79160567057`, sind zusätzlich Event-RSVP **GET/POST/DELETE** über [d1-event-participation.ts](../lib/server/d1-event-participation.ts) und die [bestehende Fassade](../lib/server/event-participation.ts) nativ portiert. Admin-Event-PUT/DELETE bleiben callbackgebunden. Die historischen v63-Methodenzeilen, Zählung und Base bleiben erhalten; dies ist kein Abschluss aller Events oder Callbacks. Positive RSVP-/FIFO-/Benachrichtigungsabnahme bleibt offen, Details und Retry-/DDL-/Legacygrenzen stehen im [Cloudflare-Guide](CLOUDFLARE_SITES.md).

Seit **v66**, Quellstand `c29d72d3cc07b2150aae03f0043adb7879c5b42e`, ist zusätzlich die Callbackbarriere der kanonischen Kursdatei-GET/HEAD-Route durch [d1-course-asset-reads.ts](../lib/server/d1-course-asset-reads.ts) und die [vorhandene Route](../app/api/courses/%5BcourseId%5D/assets/%5BassetId%5D/route.ts) entfernt. Author-/anonyme aktive Cover-/berechtigte Lerninhaltsrechte bleiben getrennt. Dateispeicher, Uploads und H5P bleiben eigene Grenzen; positive Bildbyte-/HEAD-/ACL-/Persistenzabnahme ist offen. Historische v63-Base, Zählung und Methodenzeilen bleiben unverändert; dies ist keine Gesamtfertigmeldung.

Seit **v67**, Quellstand `21ed64d8c0589fddab72ec868d2a8f3a97270278`, ist zusätzlich nur die H5P-Auswahlliste `GET /api/h5p/contents` über [d1-h5p-contents-read.ts](../lib/server/d1-h5p-contents-read.ts) und die [bestehende Listenroute](../app/api/h5p/contents/route.ts) nativ portiert. Embed, private Metadaten, Tokenassets, Import und Wiedergabezugriff bleiben getrennt. Positive nichtleere Owner-/Admin-/Datums-/Datenschutzabnahme bleibt offen; historische v63-Base, Zählung und Methodenzeilen werden dadurch nicht umgeschrieben.

## Befund und Zählweise

Der in der Inventurbasis tatsächlich importierte Prisma-Edge-Compiler weist `$transaction(function)` mit dem D1-Adapter vor dem Callback zurück. Array-Transaktionen sind ein anderer Pfad und wurden aus dieser Callbackzählung ausgeschlossen; deren Atomizität wird hier nicht bestätigt. Die reine Quellenprüfung umfasste Transaktionsreferenzen, exportierte Routen, Hilfsaufrufe, native Delegation und vorhandene UI-Anbindung. Sie führte keine Builds, Funktions-/SQL-Tests, Browser- oder Datenaktionen aus.

| Familie | v63-Zweige |
| --- | ---: |
| Kurse/Lernen | 39 |
| Admin/Konto/Moderation | 9 |
| Events | 5 |
| Space-Meldungen | 1 |
| Medien/Uploads | 9 |
| Gesamt | 63 |

Die folgenden relativen Links zeigen die mitgelieferten Repositorydateien. Zeilennummern und Aufrufzuordnung stammen aus v63; insbesondere die Follow-Implementierung wurde seitdem portiert. UI-Hinweise beschreiben Quellenanbindung, keine beobachtete Live-Ausführung. Bedingte Upload-/Token-/Retentionpfade bleiben ausdrücklich bedingt.

## Kurse und Lernen (39)

| Methode und Route | Quellaufruf | Anbindung/Bedingung |
| --- | --- | --- |
| `DELETE /api/courses/[courseId]` | [app/api/courses/[courseId]/route.ts:68](../app/api/courses/%5BcourseId%5D/route.ts#L68) | Kursoberfläche |
| `GET /api/courses/[courseId]/analytics` | [lib/server/course-analytics.ts:187](../lib/server/course-analytics.ts#L187) | Lehrendenanalyse |
| `GET /api/courses/[courseId]/analytics/export` | [lib/server/course-analytics.ts:187](../lib/server/course-analytics.ts#L187) | Lehrendenanalyse |
| `POST /api/courses/[courseId]/qa` | [lib/server/course-qa.ts:165](../lib/server/course-qa.ts#L165) | Kurs-Q&A |
| `POST /api/courses/[courseId]/qa/[questionId]/answers` | [lib/server/course-qa.ts:201](../lib/server/course-qa.ts#L201) | Kurs-Q&A |
| `PUT /api/courses/[courseId]/qa/[questionId]/solution` | [lib/server/course-qa.ts:232](../lib/server/course-qa.ts#L232) | Kurs-Q&A |
| `PATCH /api/courses/[courseId]/qa/[questionId]` | [lib/server/course-qa.ts:256](../lib/server/course-qa.ts#L256) | Kurs-Q&A |
| `PATCH /api/courses/[courseId]/qa/[questionId]/answers/[answerId]` | [lib/server/course-qa.ts:269](../lib/server/course-qa.ts#L269) | Kurs-Q&A |
| `GET /api/courses/questions` | [lib/server/question-bank.ts:66](../lib/server/question-bank.ts#L66) | Fragenbank |
| `POST /api/courses/questions` | [lib/server/question-bank.ts:90](../lib/server/question-bank.ts#L90) | Fragenbank |
| `GET /api/courses/questions/[questionId]` | [lib/server/question-bank.ts:101](../lib/server/question-bank.ts#L101) | Fragenbank |
| `PATCH /api/courses/questions/[questionId]` | [lib/server/question-bank.ts:127](../lib/server/question-bank.ts#L127) | Fragenbank |
| `GET /api/courses/questions/[questionId]/revisions/[revision]` | [lib/server/question-bank.ts:113](../lib/server/question-bank.ts#L113) | Fragenbank |
| `GET /api/courses/practice/objectives` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Liste vorgelagert betroffen |
| `POST /api/courses/practice/objectives` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Liste vorgelagert betroffen |
| `GET /api/courses/practice/objectives/[objectiveId]` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Liste vorgelagert betroffen |
| `PATCH /api/courses/practice/objectives/[objectiveId]` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Liste vorgelagert betroffen |
| `GET /api/courses/practice/objectives/[objectiveId]/items` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Liste vorgelagert betroffen |
| `POST /api/courses/practice/objectives/[objectiveId]/items` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Liste vorgelagert betroffen |
| `GET /api/courses/practice/items/[itemId]` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Liste vorgelagert betroffen |
| `PATCH /api/courses/practice/items/[itemId]` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Liste vorgelagert betroffen |
| `GET /api/courses/practice/items/[itemId]/revisions/[revision]` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Liste vorgelagert betroffen |
| `GET /api/courses/[courseId]/practice/authoring` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Laden vorgelagert betroffen |
| `PATCH /api/courses/[courseId]/practice/authoring` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Laden vorgelagert betroffen |
| `POST /api/courses/[courseId]/practice/authoring/preview` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Laden vorgelagert betroffen |
| `POST /api/courses/[courseId]/practice/authoring/publish` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Laden vorgelagert betroffen |
| `GET /api/courses/[courseId]/practice/authoring/history` | [lib/server/formative-practice.ts:106](../lib/server/formative-practice.ts#L106) | Workbench; Laden vorgelagert betroffen |
| `POST /api/courses/[courseId]/practice/learner/opt-in` | [lib/server/formative-practice-learner.ts:124](../lib/server/formative-practice-learner.ts#L124) | Lernübung; zusätzlich Retention-Gate |
| `POST /api/courses/[courseId]/practice/learner/pause` | [lib/server/formative-practice-learner.ts:124](../lib/server/formative-practice-learner.ts#L124) | Lernübung; zusätzlich Retention-Gate |
| `POST /api/courses/[courseId]/practice/learner/opt-out` | [lib/server/formative-practice-learner.ts:124](../lib/server/formative-practice-learner.ts#L124) | Lernübung; zusätzlich Retention-Gate |
| `POST /api/courses/[courseId]/practice/learner/start` | [lib/server/formative-practice-learner.ts:124](../lib/server/formative-practice-learner.ts#L124) | Lernübung; zusätzlich Retention-Gate |
| `POST /api/courses/[courseId]/practice/learner/next` | [lib/server/formative-practice-learner.ts:124](../lib/server/formative-practice-learner.ts#L124) | Lernübung; zusätzlich Retention-Gate |
| `POST /api/courses/[courseId]/practice/learner/close` | [lib/server/formative-practice-learner.ts:124](../lib/server/formative-practice-learner.ts#L124) | Lernübung; zusätzlich Retention-Gate |
| `POST /api/courses/[courseId]/practice/learner/answer` | [lib/server/formative-practice-learner.ts:124](../lib/server/formative-practice-learner.ts#L124) | Lernübung; zusätzlich Retention-Gate |
| `POST /api/courses/[courseId]/practice/learner/reset/prepare` | [lib/server/formative-practice-learner.ts:124](../lib/server/formative-practice-learner.ts#L124) | Lernübung; zusätzlich Retention-Gate |
| `POST /api/courses/[courseId]/practice/learner/reset` | [lib/server/formative-practice-learner.ts:124](../lib/server/formative-practice-learner.ts#L124) | Lernübung; zusätzlich Retention-Gate |
| `GET /api/users/[id]/courses` | [app/api/users/[id]/courses/route.ts:23](../app/api/users/%5Bid%5D/courses/route.ts#L23) | API; aktueller UI-Aufruf nicht belegt |
| `GET /api/users/[id]/enrollments` | [app/api/users/[id]/enrollments/route.ts:31](../app/api/users/%5Bid%5D/enrollments/route.ts#L31) | API; aktueller UI-Aufruf nicht belegt |
| `GET /api/courses/[courseId]/contents/[contentId]/attempts/[submissionId]/evidence` | [app/api/courses/[courseId]/contents/[contentId]/attempts/[submissionId]/evidence/route.ts:28](../app/api/courses/%5BcourseId%5D/contents/%5BcontentId%5D/attempts/%5BsubmissionId%5D/evidence/route.ts#L28) | API; aktueller UI-Aufruf nicht belegt |

## Admin, Konto und Moderation (9)

| Methode und Route | Quellaufruf | Anbindung/Bedingung |
| --- | --- | --- |
| `GET /api/reports` | [app/api/reports/route.ts:108](../app/api/reports/route.ts#L108) | Moderationsliste |
| `PATCH /api/reports/[reportId]` | [lib/server/report-review.ts:15](../lib/server/report-review.ts#L15) | Review; Liste vorgelagert betroffen |
| `PUT /api/users/[id]/profile` | [app/api/users/[id]/profile/route.ts:31](../app/api/users/%5Bid%5D/profile/route.ts#L31) | Profileditor |
| `POST /api/users/[id]/follow` | [app/api/users/[id]/follow/route.ts:52](../app/api/users/%5Bid%5D/follow/route.ts#L52) | Follow-Button; seit v64 portiert |
| `POST /api/admin/users` | [app/api/admin/users/route.ts:139](../app/api/admin/users/route.ts#L139) | Admin-Mitgliederverwaltung |
| `PUT /api/admin/users/[id]` | [app/api/admin/users/[id]/route.ts:247](../app/api/admin/users/%5Bid%5D/route.ts#L247) | Admin-Mitgliederverwaltung |
| `DELETE /api/admin/users/[id]` | [app/api/admin/users/[id]/route.ts:346](../app/api/admin/users/%5Bid%5D/route.ts#L346) | Admin-Mitgliederverwaltung |
| `PATCH /api/admin/users/[id]/test-account` | [app/api/admin/users/[id]/test-account/route.ts:23](../app/api/admin/users/%5Bid%5D/test-account/route.ts#L23) | Admin-Mitgliederverwaltung |
| `PATCH /api/users/[id]` | [app/api/users/[id]/route.ts:308](../app/api/users/%5Bid%5D/route.ts#L308) | Legacy-Skill-API; UI nicht belegt |

## Events (5)

| Methode und Route | Quellaufruf | Anbindung/Bedingung |
| --- | --- | --- |
| `GET /api/events/[id]/rsvp` | [lib/server/event-participation.ts:79,88,117](../lib/server/event-participation.ts#L79) → [lib/server/participation.ts:25](../lib/server/participation.ts#L25) | Eventpanel; Status-GET vorgelagert |
| `POST /api/events/[id]/rsvp` | [lib/server/event-participation.ts:79,88,117](../lib/server/event-participation.ts#L79) → [lib/server/participation.ts:25](../lib/server/participation.ts#L25) | Eventpanel; Status-GET vorgelagert |
| `DELETE /api/events/[id]/rsvp` | [lib/server/event-participation.ts:79,88,117](../lib/server/event-participation.ts#L79) → [lib/server/participation.ts:25](../lib/server/participation.ts#L25) | Eventpanel; Status-GET vorgelagert |
| `PUT /api/events/[id]` | [app/api/events/[id]/route.ts:69,131](../app/api/events/%5Bid%5D/route.ts#L69) → [lib/server/participation.ts:25](../lib/server/participation.ts#L25) | Admin-Eventeditor |
| `DELETE /api/events/[id]` | [app/api/events/[id]/route.ts:69,131](../app/api/events/%5Bid%5D/route.ts#L69) → [lib/server/participation.ts:25](../lib/server/participation.ts#L25) | Admin-Eventeditor |

## Space-Meldungen (1)

| Methode und Route | Quellaufruf | Anbindung/Bedingung |
| --- | --- | --- |
| `POST /api/reports` | [app/api/reports/route.ts:47](../app/api/reports/route.ts#L47) → [lib/server/space-report.ts:55,67](../lib/server/space-report.ts#L55) | Melden; ausschließlich SPACE_*-Ziele |

## Medien und Uploads (9)

| Methode und Route | Quellaufruf | Anbindung/Bedingung |
| --- | --- | --- |
| `GET /api/h5p/contents` | [app/api/h5p/contents/route.ts:16](../app/api/h5p/contents/route.ts#L16) | H5P-Auswahl |
| `GET /h5p/embed/[id]` | [lib/server/h5p-access.ts:65](../lib/server/h5p-access.ts#L65) | H5P-iframe |
| `GET /api/courses/[courseId]/assets/[assetId]` | [app/api/courses/[courseId]/assets/[assetId]/route.ts:31,71](../app/api/courses/%5BcourseId%5D/assets/%5BassetId%5D/route.ts#L31) | Kursbild; optionale Session, gültige IDs |
| `HEAD /api/courses/[courseId]/assets/[assetId]` | [app/api/courses/[courseId]/assets/[assetId]/route.ts:31,71](../app/api/courses/%5BcourseId%5D/assets/%5BassetId%5D/route.ts#L31) | Kursbild; optionale Session, gültige IDs |
| `GET /api/h5p/contents/[id]` | [lib/server/h5p-access.ts:65](../lib/server/h5p-access.ts#L65) | API; direkter UI-Fetch nicht belegt |
| `GET /api/h5p/assets/[id]/[token]/[...path]` | [lib/server/h5p-access.ts:65](../lib/server/h5p-access.ts#L65) | Vorhandener gültiger Token erforderlich |
| `HEAD /api/h5p/assets/[id]/[token]/[...path]` | [lib/server/h5p-access.ts:65](../lib/server/h5p-access.ts#L65) | Vorhandener gültiger Token erforderlich |
| `POST /api/h5p/upload` | [lib/server/h5p-storage.ts:17](../lib/server/h5p-storage.ts#L17) | Upload; erst nach erfolgreicher Dateiextraktion |
| `POST /api/courses/[courseId]/authoring/assets` | [lib/server/course-assets.ts:159](../lib/server/course-assets.ts#L159) | Upload; erst nach Codec/Dateischreiben |

## Fünf obsolete Kompatibilitätsmethoden, zusätzlich zur 63-Zählung

Diese alten Inhaltsschreibpfade sollen nach aktueller Autorisierung den vorgesehenen Obsolete-Editor-409 zurückgeben. Sie dürfen nicht als neue Live-Editor-Schreibfunktion wiederbelebt werden. Die Callbackprüfung erklärt den vorherigen Fehlpfad; sie ist keine Wiederherstellungsfreigabe.

| Methode und Route | Mitgelieferte Route |
| --- | --- |
| `POST /api/courses/[courseId]/contents` | [app/api/courses/[courseId]/contents/route.ts](../app/api/courses/%5BcourseId%5D/contents/route.ts) |
| `PUT /api/courses/[courseId]/contents/[contentId]` | [app/api/courses/[courseId]/contents/[contentId]/route.ts](../app/api/courses/%5BcourseId%5D/contents/%5BcontentId%5D/route.ts) |
| `DELETE /api/courses/[courseId]/contents/[contentId]` | [app/api/courses/[courseId]/contents/[contentId]/route.ts](../app/api/courses/%5BcourseId%5D/contents/%5BcontentId%5D/route.ts) |
| `PUT /api/courses/[courseId]/contents/[contentId]/reorder` | [app/api/courses/[courseId]/contents/[contentId]/reorder/route.ts](../app/api/courses/%5BcourseId%5D/contents/%5BcontentId%5D/reorder/route.ts) |
| `PUT /api/courses/[courseId]/contents/[contentId]/move` | [app/api/courses/[courseId]/contents/[contentId]/move/route.ts](../app/api/courses/%5BcourseId%5D/contents/%5BcontentId%5D/move/route.ts) |

## Wichtige Ausschlüsse und getrennte Diagnosen

- **Chat:** untersuchte aktuelle Chat-APIs sind callbackfrei; Senden nutzt den nativen D1-Pfad, Chatbilder D1/R2. Ein gemeldetes Bild-/Nachrichtenproblem braucht eine genaue veröffentlichte Stufe: Normalisierung, Upload, Nachrichten-POST oder Bild-GET. Diese Karte belegt keinen neuen Chatfehler.
- **Allgemeine Bilder:** Profil-/Projekt-/KB-Bilder nutzen einen separaten Dateisystem-/Codec-Pfad über [image-upload.ts](../lib/server/image-upload.ts). Die Inventur belegt nicht, welche Operation live zuerst scheitert oder ob Speicherung dauerhaft funktioniert. Ressourcenformulare speichern URLs, keine Binärdateien. Kurs-/H5P-Uploadcallbacks werden erst nach erfolgreichem Codec-/Dateischritt erreicht; ein Readport allein beweist keinen vollständigen Uploadfluss.
- **Kursformatierung:** aktuelles Authoring ist bereits nativ; Toolbar, Sanitizer und Richtextdarstellung sind separate Stufen. Ein Callbackgrund oder unabhängig nachgewiesener Formatverlust wurde durch diese Inventur nicht belegt. Alte Editor-Routen bleiben obsolet.
- **Übungs-Retention:** die eigene 45-Minuten-Heartbeat-Verfügbarkeitsgrenze darf durch einen Callbackport nicht umgangen werden. Ein Scheduler-Callback wurde keinem Sites-HTTP-Aufrufer zugeordnet; Live-Datenbankgesundheit und Schedulerbetrieb wurden nicht geprüft.
- **Bereits portiert:** aktuelles Kurslesen/-authoring, Lernpfade, Spacebasis/Discussion-/Reply-Moderation, Umfragen, Missionen, Merker und Einladungen wurden nicht wegen zurückgelassener unbenutzter Callbackhelfer als neue Funde gezählt. Space-Meldungen sind davon getrennt. `readAsAdmin` ist eine gewöhnliche Callback-Funktion, keine Prisma-Funktionstransaktion.
- **API-only:** Profilkurs-/Einschreibungs-/Quiznachweisreads bleiben aufrufbare APIs; ein gegenwärtiger UI-Aufrufer wurde nicht etabliert. Das ist keine Aussage, sie seien unzugänglich oder funktionsgeprüft.

Keine Kontonamen, Suchinhalte, Tokens, Hostingidentitäten oder privaten Prüfartefakte sind Bestandteil dieser Karte. Sie ist eine gesonderte Dokumentationsausnahme des GitHub-Backups, kein zusätzlicher Sitesquellcode und kein Live-QA-Bericht. Aktueller Auslieferungs-/Prüfstand: [Cloudflare-Guide](CLOUDFLARE_SITES.md) und [Nutzerfluss-Roadmap](USER_FLOW_ROADMAP.md).
