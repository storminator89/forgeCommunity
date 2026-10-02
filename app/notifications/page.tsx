"use client";

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, MessageSquare, Hash, CheckCircle, Trash2, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from '@/contexts/NotificationContext';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const notificationLabels: Record<string, string> = {
  CHAT_MESSAGE: 'Chatnachricht',
  CHANNEL_CREATED: 'Neuer Channel',
  CHANNEL_DELETED: 'Channel gelöscht',
};

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const { notifications, markAsRead, deleteNotification, markAllAsRead } = useNotifications();
  const reduceMotion = useReducedMotion();
  const unreadCount = notifications.filter(n => !n.isRead).length;
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
    <TooltipProvider>
      <AppShell>
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AppHeader>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h1 className="min-w-0 truncate">Benachrichtigungen</h1>
              <div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div>
            </div>
          </AppHeader>

          <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full p-4 lg:p-8">
              <div className="mx-auto max-w-3xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Benachrichtigungen filtern">
                    <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Alle <span className="ml-2 opacity-70">{notifications.length}</span></Button>
                    <Button size="sm" variant={filter === 'unread' ? 'default' : 'outline'} aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>Ungelesen <span className="ml-2 opacity-70">{unreadCount}</span></Button>
                  </div>
                  <Button variant="outline" size="sm" disabled={unreadCount === 0} onClick={() => markAllAsRead()} className="gap-2">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /><span>Alle als gelesen markieren</span>
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground" role="status">{unreadCount === 0 ? 'Du bist auf dem aktuellen Stand.' : `${unreadCount} ungelesene ${unreadCount === 1 ? 'Benachrichtigung' : 'Benachrichtigungen'}`}</p>
                <AnimatePresence initial={false}>
                  {filteredNotifications.map(notification => (
                    <motion.article key={notification.id}
                      initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: reduceMotion ? 0 : -12 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}
                      className={`flex gap-3 rounded-xl border bg-card p-4 ${!notification.isRead ? 'border-primary/40' : 'border-border'}`}>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{getIcon(notification.type)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{notificationLabels[notification.type] ?? 'Mitteilung'}</Badge>
                          {!notification.isRead && <span className="text-xs font-medium text-primary">Neu</span>}
                        </div>
                        <p className={`break-words text-sm [overflow-wrap:anywhere] ${notification.isRead ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>{notification.content}</p>
                        <time dateTime={new Date(notification.createdAt).toISOString()} className="mt-2 block text-xs text-muted-foreground">{format(new Date(notification.createdAt), 'PPp', { locale: de })}</time>
                        <div className="mt-2 flex flex-wrap gap-1 sm:hidden">
                          {!notification.isRead && <Button variant="ghost" size="sm" className="gap-2" onClick={() => markAsRead(notification.id)}><CheckCircle className="h-4 w-4" aria-hidden="true" />Als gelesen markieren</Button>}
                          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={() => deleteNotification(notification.id)}><Trash2 className="h-4 w-4" aria-hidden="true" />Löschen</Button>
                        </div>
                      </div>
                      <div className="hidden shrink-0 items-start gap-1 sm:flex">
                        {!notification.isRead && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Als gelesen markieren" onClick={() => markAsRead(notification.id)}><CheckCircle className="h-4 w-4 text-primary" /></Button></TooltipTrigger><TooltipContent>Als gelesen markieren</TooltipContent></Tooltip>}
                        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Benachrichtigung löschen" onClick={() => deleteNotification(notification.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></TooltipTrigger><TooltipContent>Löschen</TooltipContent></Tooltip>
                      </div>
                    </motion.article>
                  ))}
                </AnimatePresence>
                {filteredNotifications.length === 0 && (
                  <div className="rounded-xl border bg-card px-4 py-12 text-center">
                    <Bell className="mx-auto mb-4 h-10 w-10 text-muted-foreground" aria-hidden="true" />
                    <h2 className="font-semibold">{filter === 'unread' ? 'Alles gelesen' : 'Noch keine Benachrichtigungen'}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">{filter === 'unread' ? 'Hier erscheinen deine neuen Benachrichtigungen.' : 'Sobald es Neuigkeiten in deiner Community gibt, findest du sie hier.'}</p>
                    {filter === 'unread' && notifications.length > 0 && <Button variant="outline" size="sm" className="mt-4" onClick={() => setFilter('all')}>Alle Benachrichtigungen anzeigen</Button>}
                  </div>
                )}
              </div>
            </ScrollArea>
          </main>
        </div>
      </AppShell>
    </TooltipProvider>
  );
}
