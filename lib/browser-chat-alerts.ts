// Same-tab preference updates let the chat provider follow a successful
// Settings save without putting private account preferences in localStorage.
export const BROWSER_CHAT_ALERT_PREFERENCE_EVENT = 'forge:browser-chat-alert-preference';

export interface BrowserChatAlertPreference {
  userId: string;
  enabled: boolean;
}

export function publishBrowserChatAlertPreference(preference: BrowserChatAlertPreference) {
  window.dispatchEvent(new CustomEvent<BrowserChatAlertPreference>(
    BROWSER_CHAT_ALERT_PREFERENCE_EVENT,
    { detail: preference },
  ));
}
