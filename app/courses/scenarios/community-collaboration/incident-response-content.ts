import type { MissionDefinition } from './mission-definition';

// Authored hypothetical managed-laptop case. The legacy station/slot names are
// private engine aliases: SHARE=CONTAIN, VERIFY=REPORT, ACCESS=RECOVER;
// content=medium, recipient=report, access=work. They never cross mission keys.
export const incidentResponseMission = {
  id: 'incident-response', version: 1, key: 'incident-response@1',
  href: '/courses/scenarios/incident-response',
  title: 'Schadsoftware eindämmen', cardTitle: 'Gerät unter Verdacht', category: 'Gerätesicherheit',
  summary: 'Eingrenzen. Melden. Sicher weiterarbeiten.', startLabel: 'Fall starten',
  introLead: 'Fiktiver Arbeitslaptop. Laut eurem Notfallplan darfst du ihn vom Netz trennen. Untersuchung und Freigabe übernimmt die IT.',
  introDiagram: ['Eingrenzen', 'Melden', 'Weiterarbeiten'],
  takeaway: 'Erst eingrenzen, dann Fakten melden. Sicher weiterarbeiten nach Freigabe der IT.',
  simulationNote: 'Nur Simulation. Es wird kein Gerät verändert und nichts versendet.',
  visual: 'containment',
  choiceVisuals: {
    SHARE: { before: 'Arbeitslaptop im Firmen-WLAN', outcomes: {
      contain_restart: 'Neustart vor der Untersuchung', contain_isolate: 'Netz getrennt · Laptop eingeschaltet', contain_tool: 'Zusätzliches Programm auf dem Laptop',
    } },
    SHARE_REPAIR: { before: 'Verbindung und Gerätezustand', outcomes: {
      repair_contain_tab: 'Fenster geschlossen · Netz verbunden', repair_contain_network: 'Netz getrennt · Laptop eingeschaltet', repair_contain_delete: 'Dateien vor der Untersuchung gelöscht',
    } },
    VERIFY: { before: 'Separates Telefon · Bekannte IT-Notfallnummer', outcomes: {
      report_wait: 'Meldung erst später', report_certain: 'Unbestätigte Gesamtdiagnose', report_facts: 'Konkrete Beobachtungen an die IT',
    } },
    VERIFY_REPAIR: { before: 'Laptop · Zeitpunkt · Symptome · Netztrennung', outcomes: {
      repair_report_facts: 'Beobachtungen und Schritte an die IT', repair_report_blame: 'Unbelegte Beschuldigung', repair_report_vague: 'Meldung ohne die vorhandenen Einzelheiten',
    } },
    ACCESS: { before: 'Ungeprüfter Laptop · Vorhandene Sicherung', outcomes: {
      recover_immediate: 'Sicherung auf ungeprüftem Laptop', recover_approved: 'IT prüft Gerät und Sicherung', recover_reconnect: 'Ungeprüfter Laptop wieder verbunden',
    } },
  },
  mainStations: [
    { id: 'SHARE', label: 'Eingrenzen', recap: 'Ausbreitung begrenzen' },
    { id: 'VERIFY', label: 'Melden', recap: 'Beobachtungen melden' },
    { id: 'ACCESS', label: 'Weiterarbeiten', recap: 'Freigabe abwarten' },
    { id: 'TRANSFER', label: 'Neuer Fall', recap: 'Neuer Fall' },
  ],
  choiceNodes: {
    SHARE: {
      id: 'SHARE', title: 'Verdacht eingrenzen',
      situation: 'Mehrere Dokumente lassen sich plötzlich nicht öffnen. Eine neue Textdatei fordert Geld. Dein Arbeitslaptop ist im Firmen-WLAN.',
      prompt: 'Was tust du zuerst?',
      options: [
        { id: 'contain_restart', label: 'Neu starten und prüfen, ob alles wieder geht.', correct: false, consequence: 'Du würdest den Laptop neu starten, bevor die IT ihn untersucht.' },
        { id: 'contain_isolate', label: 'Arbeit stoppen, Laptop vom Netz trennen und eingeschaltet lassen.', correct: true, consequence: 'Der Laptop wäre vom Netz getrennt und für die Untersuchung eingeschaltet.' },
        { id: 'contain_tool', label: 'Ein kostenloses Reparaturtool suchen und sofort ausführen.', correct: false, consequence: 'Du würdest auf dem verdächtigen Laptop ein weiteres Programm ausführen.' },
      ],
      feedback: {
        correct: 'Das begrenzt mögliche Ausbreitung und erhält Spuren. Die IT muss Ursache und Umfang noch prüfen.',
        incorrect: 'Neustarts und zusätzliche Programme können Spuren verändern. Hier gilt: erst eingrenzen, dann nach Notfallplan melden.',
      },
    },
    SHARE_REPAIR: {
      id: 'SHARE_REPAIR', title: 'Verbindung unterbrechen',
      situation: 'Du möchtest mögliche Ausbreitung begrenzen und den Zustand für die IT erhalten.',
      prompt: 'Welcher Schritt passt dazu?',
      options: [
        { id: 'repair_contain_tab', label: 'Nur das Fenster mit der Geldforderung schließen.', correct: false, consequence: 'Das Fenster wäre geschlossen; die Netzverbindung bliebe bestehen.' },
        { id: 'repair_contain_network', label: 'Netzverbindungen trennen; den Laptop eingeschaltet lassen.', correct: true, consequence: 'Die Netzverbindungen wären getrennt; die IT könnte den eingeschalteten Laptop untersuchen.' },
        { id: 'repair_contain_delete', label: 'Die verdächtigen Dateien vor der Meldung löschen.', correct: false, consequence: 'Du würdest Dateien entfernen, bevor die IT sie untersuchen kann.' },
      ],
      feedback: {
        correct: 'Du begrenzt Verbindungen, ohne selbst aufzuräumen.',
        incorrect: 'Ein geschlossenes Fenster trennt kein Netzwerk. Selbstständiges Löschen kann wichtige Spuren entfernen.',
      },
    },
    VERIFY: {
      id: 'VERIFY', title: 'Beobachtungen melden',
      situation: 'Die IT hat inzwischen die Netztrennung übernommen. Ein separates Telefon und die bekannte IT-Notfallnummer sind verfügbar.',
      prompt: 'Welche Meldung hilft jetzt?',
      options: [
        { id: 'report_wait', label: 'Erst morgen melden, falls das Problem noch besteht.', correct: false, consequence: 'Die IT würde erst später von deinen Beobachtungen erfahren.' },
        { id: 'report_certain', label: 'Der IT melden: „Alle Geräte sind gehackt“, ohne weitere Angaben.', correct: false, consequence: 'Die IT bekäme eine unbestätigte Gesamtdiagnose ohne konkrete Beobachtungen.' },
        { id: 'report_facts', label: 'IT anrufen: Laptop, Zeitpunkt, sichtbare Meldung und bisherige Schritte nennen.', correct: true, consequence: 'Die IT bekäme konkrete Beobachtungen über den getrennten Meldeweg.' },
      ],
      feedback: {
        correct: 'Fakten und bisherige Schritte helfen bei der Einordnung. Du musst die Ursache nicht selbst beweisen.',
        incorrect: 'Melde den Verdacht zeitnah. Beschreibe Beobachtungen und Schritte, statt einen Angriffsumfang zu behaupten.',
      },
    },
    VERIFY_REPAIR: {
      id: 'VERIFY_REPAIR', title: 'Fakten statt Diagnose',
      situation: 'Du weißt: Laptop L-17, erstmals 10:20 Uhr, Dateien öffnen nicht, Geldforderung, WLAN getrennt.',
      prompt: 'Was gibst du an die IT weiter?',
      options: [
        { id: 'repair_report_facts', label: 'Genau diese Beobachtungen und Schritte; Ursache noch unbekannt.', correct: true, consequence: 'Die IT bekäme Zeitpunkt, betroffenes Gerät, Symptome und deinen bisherigen Schritt.' },
        { id: 'repair_report_blame', label: '„Jemand aus dem Team hat uns angegriffen.“', correct: false, consequence: 'Die IT bekäme eine unbelegte Beschuldigung statt der vorhandenen Fakten.' },
        { id: 'repair_report_vague', label: '„Laptop kaputt“, ohne weitere Angaben.', correct: false, consequence: 'Zeitpunkt, sichtbare Meldung und die Netztrennung würden in der Meldung fehlen.' },
      ],
      feedback: {
        correct: 'Das sind überprüfbare Hinweise. Unbekanntes darf unbekannt bleiben.',
        incorrect: 'Gerät, Zeitpunkt, Symptome und bisherige Schritte sind hilfreicher als Vermutungen oder eine ungenaue Kurzmeldung.',
      },
    },
    ACCESS: {
      id: 'ACCESS', title: 'Sicher weiterarbeiten',
      situation: 'Die IT prüft den Vorfall noch. Eine Sicherung ist vorhanden; dein Laptop wurde noch nicht freigegeben.',
      prompt: 'Wie gehst du mit der Sicherung um?',
      options: [
        { id: 'recover_immediate', label: 'Die Sicherung sofort auf den ungeprüften Laptop zurückspielen.', correct: false, consequence: 'Du würdest die Sicherung auf dem noch ungeprüften Laptop wiederherstellen.' },
        { id: 'recover_approved', label: 'Mit der IT erst das Gerät bereinigen und die Sicherung prüfen lassen.', correct: true, consequence: 'Die IT würde vor der Wiederherstellung Gerät und Sicherung prüfen.' },
        { id: 'recover_reconnect', label: 'Den Laptop für die automatische Cloud-Synchronisierung wieder verbinden.', correct: false, consequence: 'Du würdest den ungeprüften Laptop wieder verbinden und Daten synchronisieren.' },
      ],
      feedback: {
        correct: 'Wiederherstellung folgt auf die Bereinigung. Die IT entscheidet, wann Gerät und Daten wieder genutzt werden können.',
        incorrect: 'Auf einem ungeprüften Gerät können wiederhergestellte Daten erneut betroffen sein. Erst mit der IT Bereinigung und Sicherung klären.',
      },
    },
  },
  transfer: {
    title: 'Jetzt ein anderer Fall',
    situation: 'Im Kursraum liegt ein unbeschrifteter USB-Stick. Er wurde noch nirgends angeschlossen. Du brauchst die Projektunterlagen für die nächste Aufgabe.',
    prompt: 'Baue einen sicheren nächsten Schritt.',
    feedback: 'Der Fund wird sachlich gemeldet. Du schaffst keine neue Verbindung und nutzt eine bekannte Quelle für deine Arbeit.',
  },
  transferSlots: [
    {
      id: 'content', label: 'Stick', correctValue: 'found_to_it',
      options: [
        { id: 'found_to_it', label: 'Nicht anschließen; bei der zuständigen IT abgeben', consequence: 'Der unbekannte Stick würde ungeöffnet an die IT gehen.' },
        { id: 'try_private', label: 'Am eigenen Laptop ausprobieren', consequence: 'Der unbekannte Stick würde mit deinem Laptop verbunden.' },
      ],
      correction: 'Ein unbekannter Stick sollte nicht versuchsweise angeschlossen werden. Gib ihn der zuständigen IT.',
    },
    {
      id: 'recipient', label: 'Meldung', correctValue: 'factual_find',
      options: [
        { id: 'blame_attack', label: 'Einen Angriff durch eine bestimmte Person behaupten', consequence: 'Du würdest ohne Beleg eine Person beschuldigen.' },
        { id: 'factual_find', label: 'Fundort und Zeitpunkt nennen; Inhalt unbekannt', consequence: 'Du würdest den Fund mit Ort, Zeitpunkt und offenem Wissensstand melden.' },
      ],
      correction: 'Du kennst Fundort und Zeitpunkt, aber weder Inhalt noch Ursache. Melde diese Fakten ohne Beschuldigung.',
    },
    {
      id: 'access', label: 'Unterlagen', correctValue: 'known_storage',
      options: [
        { id: 'known_storage', label: 'Die bekannte Projektablage nutzen', consequence: 'Du würdest die Unterlagen aus der bekannten Projektablage holen.' },
        { id: 'try_other', label: 'Den Stick an einem anderen Rechner testen', consequence: 'Der unbekannte Stick würde mit einem weiteren Rechner verbunden.' },
      ],
      correction: 'Ein anderer Rechner macht den unbekannten Stick nicht vertrauenswürdig. Nutze die bekannte Projektablage.',
    },
  ],
  transferReferenceTitle: 'Passender nächster Schritt',
  transferExampleTitle: 'Beispiel für einen passenden nächsten Schritt',
  transferReference: ['Stick an die IT', 'Fundort und Zeitpunkt', 'Bekannte Projektablage'],
  transferFitLabel: 'Passt zu diesem Fall',
  // The wrong actions have distinct consequences; no unsupported equal-risk claim.
  equalRiskNodes: [],
  sources: [
    { title: 'CISA: #StopRansomware Guide', href: 'https://www.cisa.gov/stopransomware/ransomware-guide' },
    { title: 'BSI: Checkliste für IT-Sicherheitsvorfälle', href: 'https://www.bsi.bund.de/DE/IT-Sicherheitsvorfall/Unternehmen/Ich-habe-einen-IT-Sicherheitsvorfall-Checkliste-Organisatorisches/ich-habe-einen-it-sicherheitsvorfall-checkliste-organisatorisches.html' },
    { title: 'Microsoft: Responding to ransomware attacks', href: 'https://learn.microsoft.com/en-us/defender-xdr/playbook-responding-ransomware-m365-defender' },
    { title: 'CISA: Risks of Using Portable Devices', href: 'https://www.cisa.gov/sites/default/files/publications/RisksOfPortableDevices.pdf' },
  ],
} as const satisfies MissionDefinition;
