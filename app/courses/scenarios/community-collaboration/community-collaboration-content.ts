// Authored voluntary simulation. This is separate from course content, quizzes,
// learner practice, and real sharing or sign-in actions. No scoring or storage.
export type ChoiceNodeId = 'SHARE' | 'SHARE_REPAIR' | 'VERIFY' | 'VERIFY_REPAIR' | 'ACCESS';
export type NodeId = ChoiceNodeId | 'TRANSFER';
export type MainNodeId = 'SHARE' | 'VERIFY' | 'ACCESS' | 'TRANSFER';
export type RepairNodeId = 'SHARE_REPAIR' | 'VERIFY_REPAIR';

export type Choice = { id: string; label: string; correct: boolean; consequence?: string };
export type ChoiceNode = {
  id: ChoiceNodeId;
  title: string;
  situation: string;
  prompt: string;
  options: readonly Choice[];
  feedback: { correct: string; incorrect: string };
};

export const mainStations: readonly { id: MainNodeId; label: string; recap: string }[] = [
  { id: 'SHARE', label: 'Informationen', recap: 'Informationen begrenzen' },
  { id: 'VERIFY', label: 'Hilfe', recap: 'Hilfe unabhängig prüfen' },
  { id: 'ACCESS', label: 'Zugriff', recap: 'Zugriff passend wählen' },
  { id: 'TRANSFER', label: 'Neuer Fall', recap: 'Neuer Fall' },
];

export const choiceNodes: Record<ChoiceNodeId, ChoiceNode> = {
  SHARE: {
    id: 'SHARE', title: 'Hilfe holen',
    situation: 'Du brauchst Hilfe zu einer Kursaufgabe. Dein Screenshot enthält auch eine private Nachricht und eine E-Mail-Adresse.',
    prompt: 'Was gehört in deine öffentliche Frage?',
    options: [
      { id: 'share_minimal', label: 'Nur Aufgabenstelle und Frage, ohne private Nachricht oder Kontaktangaben.', correct: true, consequence: 'In dieser Simulation würde die öffentliche Frage nur Aufgabenstelle und Frage enthalten.' },
      { id: 'share_raw', label: 'Der ganze Screenshot. So ist der Zusammenhang vollständig.', correct: false, consequence: 'In dieser Simulation würde der ganze Screenshot mit privater Nachricht und E-Mail-Adresse in der öffentlichen Frage stehen.' },
      { id: 'share_closed', label: 'Der Screenshot in einer kleineren Gruppe. Dann ist er privat genug.', correct: false, consequence: 'In dieser Simulation würde der Screenshot mit privater Nachricht und E-Mail-Adresse in einer kleineren Gruppe geteilt.' },
    ],
    feedback: {
      correct: 'Die Frage bleibt verständlich. Private Details bleiben draußen.',
      incorrect: 'Mehr Kontext teilt hier auch fremde private Informationen. Ein kleinerer Empfängerkreis ersetzt keine Freigabe.',
    },
  },
  SHARE_REPAIR: {
    id: 'SHARE_REPAIR', title: 'Beispiel bereinigen',
    situation: 'Für die Erklärung brauchst du nur den fehlerhaften Arbeitsschritt.',
    prompt: 'Welche Fassung hilft ohne unnötige Daten?',
    options: [
      { id: 'repair_share_name', label: 'Nur den Namen schwärzen, die ganze private Nachricht stehen lassen.', correct: false },
      { id: 'repair_share_steps', label: 'Ein neutrales Beispiel des Arbeitsschritts und meine Frage.', correct: true },
      { id: 'repair_share_email', label: 'Die private Nachricht weglassen, die E-Mail-Adresse zur Rückfrage stehen lassen.', correct: false },
    ],
    feedback: {
      correct: 'Das nötige Beispiel reicht.',
      incorrect: 'Hier reicht ein neutrales Beispiel. Private Nachrichten und Kontaktangaben brauchst du dafür nicht.',
    },
  },
  VERIFY: {
    id: 'VERIFY', title: 'Hilfe prüfen',
    situation: 'Eine unerwartete Nachricht behauptet, vom Support zu sein. Zur Hilfe sollst du dein Passwort oder einen Anmeldecode schicken.',
    prompt: 'Was tust du zuerst?',
    options: [
      { id: 'verify_code', label: 'Nur den Einmalcode schicken. Das Passwort bleibt ja geheim.', correct: false, consequence: 'In dieser Simulation würdest du den Einmalcode an die Person aus der unerwarteten Nachricht schicken.' },
      { id: 'verify_official', label: 'Nichts schicken. Plattform selbst öffnen und den offiziellen Hilfsweg prüfen.', correct: true, consequence: 'In dieser Simulation würdest du nichts schicken und den Hilfsweg auf der selbst geöffneten Plattform prüfen.' },
      { id: 'verify_link', label: 'Den Link aus der Nachricht öffnen und dort die Zugangsdaten eingeben.', correct: false, consequence: 'In dieser Simulation würdest du Zugangsdaten auf der Seite aus dem Nachrichtenlink eingeben.' },
    ],
    feedback: {
      correct: 'Du prüfst den Hilfsweg unabhängig. Deine Anmeldung bleibt bei dir.',
      incorrect: 'Passwort und Anmeldecode können Zugang geben. Auch ein Link in der Nachricht ist kein Nachweis für echten Support.',
    },
  },
  VERIFY_REPAIR: {
    id: 'VERIFY_REPAIR', title: 'Vertrauen unabhängig prüfen',
    situation: 'Die Nachricht zeigt ein bekanntes Logo und drängt: „Nur noch zwei Minuten.“',
    prompt: 'Was ist ein verlässlicher nächster Schritt?',
    options: [
      { id: 'repair_verify_logo', label: 'Das Logo mit der Plattform vergleichen und dann den Code schicken.', correct: false },
      { id: 'repair_verify_sender', label: 'Die Person in derselben Nachricht fragen, ob sie wirklich Support ist.', correct: false },
      { id: 'repair_verify_known', label: 'Die bekannte Plattform direkt öffnen und dort nach Hilfe suchen.', correct: true },
    ],
    feedback: {
      correct: 'Der unabhängig geöffnete Hilfsweg ist die bessere Prüfung.',
      incorrect: 'Logo, Zeitdruck und Selbstbestätigung belegen die Identität nicht. Nutze einen unabhängig geöffneten Hilfsweg.',
    },
  },
  ACCESS: {
    id: 'ACCESS', title: 'Passenden Zugriff wählen',
    situation: 'Eine benannte Person soll Rückmeldung zu einem Entwurf geben. Im selben Ordner liegen zusätzliche persönliche Notizen.',
    prompt: 'Welche Freigabe passt zum Auftrag?',
    options: [
      { id: 'access_folder', label: 'Den ganzen Ordner mit Bearbeitungsrecht freigeben.', correct: false },
      { id: 'access_login', label: 'Meinen Login teilen. Dann kann die Person alles selbst öffnen.', correct: false },
      { id: 'access_scoped', label: 'Nur den Entwurf für diese Person zum Kommentieren freigeben.', correct: true },
    ],
    feedback: {
      correct: 'Aufgabe und Zugriff passen zusammen: ein Entwurf, eine Person, Kommentare.',
      incorrect: 'Für Rückmeldung genügen der Entwurf und Kommentarzugriff. Andere Dateien und dein Login werden nicht gebraucht.',
    },
  },
};

export const transfer = {
  title: 'Jetzt ein anderer Fall',
  situation: 'Du planst einen Community-Termin. Eine helfende Person braucht nur Aufgabe und Uhrzeit. Deine Arbeitsnotiz enthält außerdem private E-Mail-Adressen und interne Kommentare.',
  prompt: 'Baue einen passenden Freigabeplan.',
  feedback: 'Dein Plan gibt genau die Informationen und Rechte, die für diese Hilfe nötig sind.',
} as const;

export const transferSlots = [
  {
    id: 'content', label: 'Inhalt', correctValue: 'task_time',
    options: [{ id: 'task_time', label: 'Aufgabe und Uhrzeit' }, { id: 'full_note', label: 'Komplette Arbeitsnotiz' }],
    correction: 'Die komplette Notiz gibt unnötige private Details weiter.',
  },
  {
    id: 'recipient', label: 'Empfänger', correctValue: 'named_helper',
    options: [{ id: 'anyone_link', label: 'Alle mit dem Link' }, { id: 'named_helper', label: 'Die benannte helfende Person' }],
    correction: 'Ein offener Link erreicht mehr Personen als nötig.',
  },
  {
    id: 'access', label: 'Zugriff', correctValue: 'read',
    options: [{ id: 'edit_share', label: 'Bearbeiten und weiterfreigeben' }, { id: 'read', label: 'Lesen' }],
    correction: 'Zum Ablesen von Aufgabe und Uhrzeit genügt Lesen.',
  },
] as const;

export type TransferSlotId = (typeof transferSlots)[number]['id'];
export type TransferPlan = {
  content: 'task_time' | 'full_note' | null;
  recipient: 'named_helper' | 'anyone_link' | null;
  access: 'read' | 'edit_share' | null;
};
export type CompleteTransferPlan = { [K in keyof TransferPlan]: NonNullable<TransferPlan[K]> };

export function parentStation(nodeId: NodeId): MainNodeId {
  if (nodeId === 'SHARE_REPAIR') return 'SHARE';
  if (nodeId === 'VERIFY_REPAIR') return 'VERIFY';
  return nodeId;
}

export function isRepair(nodeId: NodeId): nodeId is RepairNodeId {
  return nodeId === 'SHARE_REPAIR' || nodeId === 'VERIFY_REPAIR';
}
