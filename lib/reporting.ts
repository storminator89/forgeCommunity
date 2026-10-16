export const reportReasons = [
  { value: 'SPAM', label: 'Spam oder Werbung' },
  { value: 'HARASSMENT', label: 'Belästigung' },
  { value: 'HATE', label: 'Hassrede' },
  { value: 'UNSAFE', label: 'Gefährlicher Inhalt' },
  { value: 'OTHER', label: 'Anderer Grund' },
] as const;

export type ReportReason = (typeof reportReasons)[number]['value'];
export type ReportTargetType = 'POST' | 'COMMENT' | 'SPACE_DISCUSSION' | 'SPACE_REPLY' | 'SPACE_MISSION_CONTRIBUTION';
export type ReportStatus = 'OPEN' | 'DISMISSED' | 'RESOLVED';

export function isReportReason(value: unknown): value is ReportReason {
  return reportReasons.some((reason) => reason.value === value);
}

export function isReportTargetType(value: unknown): value is ReportTargetType {
  return value === 'POST' || value === 'COMMENT' || value === 'SPACE_DISCUSSION' || value === 'SPACE_REPLY' || value === 'SPACE_MISSION_CONTRIBUTION';
}

export function reportReasonLabel(value: string): string {
  return reportReasons.find((reason) => reason.value === value)?.label ?? 'Unbekannter Grund';
}
