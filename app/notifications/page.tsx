"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: activity ledger · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Bell, MessageSquare, Hash, CheckCircle, Trash2, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useNotifications } from '@/contexts/NotificationContext';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { PageState } from '@/components/page-state';

const notificationLabels: Record<string, string> = {
  CHAT_MESSAGE: 'Chatnachricht',
  CHANNEL_CREATED: 'Neuer Channel',
  CHANNEL_DELETED: 'Channel gelöscht',
  FOLLOW: 'Neuer Follower',
  COMMENT: 'Neuer Kommentar',
};

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openErrorId, setOpenErrorId] = useState<string | null>(null);
  const router = useRouter();
  const { notifications, unreadCount, isLoading, loadError, retry, markAsRead, deleteNotification, markAllAsRead, openNotification } = useNotifications();
  const reduceMotion = useReducedMotion();
  const filteredNotifications = filter === 'all' ? notifications : notifications.filter(n => !n.isRead);

  const getIcon = (type: string) => {
    switch (type) {
      case 'CHAT_MESSAGE': return <MessageSquare className="h-5 w-5" aria-hidden="true" />;
      case 'CHANNEL_CREATED': return <Hash className="h-5 w-5" aria-hidden="true" />;
      case 'CHANNEL_DELETED': return <Trash2 className="h-5 w-5" aria-hidden="true" />;
      default: return <Bell className="h-5 w-5" aria-hidden="true" />;
    }
  };

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h1 className="min-w-0 truncate">Benachrichtigungen</h1>
            <div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Deine Aktivität</p>
                <p className="mt-2 text-sm text-muted-foreground" role="status">{unreadCount === 0 ? 'Du bist auf dem aktuellen Stand.' : `${unreadCount} ungelesene ${unreadCount === 1 ? 'Benachrichtigung' : 'Benachrichtigungen'}`}</p>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={unreadCount === 0} onClick={() => markAllAsRead()}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Alle als gelesen markieren
              </Button>
            </div>

            <div className="flex gap-2 border-b py-3" role="group" aria-label="Benachrichtigungen filtern">
              <Button type="button" size="sm" variant={filter === 'all' ? 'secondary' : 'ghost'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Alle <span className="text-muted-foreground">{notifications.length}</span></Button>
              <Button type="button" size="sm" variant={filter === 'unread' ? 'secondary' : 'ghost'} aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>Ungelesen <span className="text-muted-foreground">{unreadCount}</span></Button>
            </div>

            {loadError && <div className="mt-6"><PageState kind="error" title="Aktualisierung fehlgeschlagen" description={loadError}
              action={<Button type="button" variant="outline" onClick={retry}>Erneut versuchen</Button>} /></div>}
            {isLoading && <div className="mt-6"><PageState kind="loading" title="Benachrichtigungen werden geladen" /></div>}

            <div aria-live="polite">
              <AnimatePresence initial={false}>
                {filteredNotifications.map(notification => (
                  <motion.article key={notification.id}
                    initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }} transition={{ duration: reduceMotion ? 0 : 0.15 }}
                    className={`relative grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b py-6 sm:gap-5 ${!notification.isRead ? 'before:absolute before:inset-y-5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary' : ''}`}>
                    <div className={`ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${notification.isRead ? 'bg-muted text-muted-foreground' : 'bg-accent text-primary'}`}>{getIcon(notification.type)}</div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{notificationLabels[notification.type] ?? 'Mitteilung'}</span>
                        {!notification.isRead && <span className="text-xs font-semibold text-primary">Neu</span>}
                      </div>
                      <p className={`mt-2 break-words text-sm leading-relaxed [overflow-wrap:anywhere] ${notification.isRead ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>{notification.content}</p>
                      <time dateTime={new Date(notification.createdAt).toISOString()} className="mt-2 block text-xs text-muted-foreground">{format(new Date(notification.createdAt), 'PPp', { locale: de })}</time>
                      <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
                        {notification.targetState === 'available' && notification.actionLabel && <Button type="button" variant="outline" size="sm" disabled={openingId === notification.id} onClick={async () => {
                          setOpeningId(notification.id);
                          setOpenErrorId(null);
                          try {
                            const href = await openNotification(notification.id);
                            if (href) router.push(href);
                            else setOpenErrorId(notification.id);
                          } finally { setOpeningId(null); }
                        }}><ArrowUpRight className="h-4 w-4" aria-hidden="true" />{openingId === notification.id ? 'Wird geöffnet…' : notification.actionLabel}</Button>}
                        {!notification.isRead && <Button type="button" variant="ghost" size="sm" onClick={() => markAsRead(notification.id)}><CheckCircle className="h-4 w-4" aria-hidden="true" />Als gelesen markieren</Button>}
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => deleteNotification(notification.id)}><Trash2 className="h-4 w-4" aria-hidden="true" />Löschen</Button>
                      </div>
                      {notification.targetState === 'unavailable' && <p className="mt-2 text-xs text-muted-foreground">Dieses Ziel wurde gelöscht oder ist nicht mehr für dich sichtbar.</p>}
                      {openErrorId === notification.id && <p role="status" className="mt-2 text-xs text-destructive">Das Ziel konnte nicht geöffnet werden. Die Liste wird aktualisiert.</p>}
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
            </div>

            {!isLoading && !loadError && filteredNotifications.length === 0 && (
              <div className="py-16 text-center" role="status">
                <Bell className="mx-auto mb-4 h-9 w-9 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-xl font-semibold">{filter === 'unread' ? 'Alles gelesen' : 'Noch keine Benachrichtigungen'}</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{filter === 'unread' ? 'Hier erscheinen deine neuen Benachrichtigungen.' : 'Sobald es Neuigkeiten in deiner Community gibt, findest du sie hier.'}</p>
                {filter === 'unread' && notifications.length > 0 && <Button type="button" variant="outline" size="sm" className="mt-5" onClick={() => setFilter('all')}>Alle Benachrichtigungen anzeigen</Button>}
              </div>
            )}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
