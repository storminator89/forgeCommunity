// app/notifications/page.tsx
"use client";

import { useState, useEffect } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Menu, Bell, MessageSquare, Calendar, Book, CheckCircle, Trash2, Filter, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from '@/contexts/NotificationContext';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function NotificationsPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const { 
    notifications, 
    markAsRead, 
    deleteNotification, 
    markAllAsRead 
  } = useNotifications();

  const getIcon = (type: string) => {
    switch(type) {
      case 'CHAT_MESSAGE':
        return <MessageSquare className="h-5 w-5 text-blue-500" />;
      case 'CHANNEL_CREATED':
        return <Calendar className="h-5 w-5 text-green-500" />;
      case 'CHANNEL_DELETED':
        return <Trash2 className="h-5 w-5 text-red-500" />;
      default:
        return <Bell className="h-5 w-5 text-gray-500" />;
    }
  };

  const filteredNotifications = filter === 'all' 
    ? notifications 
    : notifications.filter(n => !n.isRead);

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar className="hidden md:block" />
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="border-b">
            <div className="h-16 px-4 flex items-center justify-between">
              <div className="flex items-center">
                <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                  <Menu className="h-6 w-6" />
                </Button>
                <h2 className="text-2xl font-bold">Benachrichtigungen</h2>
              </div>
              <div className="flex items-center space-x-4">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setFilter(filter === 'all' ? 'unread' : 'all')}
                  className="flex items-center space-x-2"
                >
                  <Filter className="h-4 w-4" />
                  <span>{filter === 'all' ? 'Alle' : 'Ungelesen'}</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => markAllAsRead()}
                  className="flex items-center space-x-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Alle als gelesen markieren</span>
                </Button>
                <ThemeToggle />
                <UserNav />
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-hidden">
            <ScrollArea className="h-full p-4 lg:p-8">
              <div className="max-w-2xl mx-auto space-y-4">
                <AnimatePresence>
                  {filteredNotifications.map((notification) => (
                    <motion.div
                      key={notification.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                      className={`bg-card p-4 rounded-lg shadow-md flex items-start space-x-4 ${
                        !notification.isRead ? 'border-l-4 border-primary' : ''
                      } hover:shadow-lg transition-all duration-300`}
                    >
                      <div className="flex-shrink-0">
                        {getIcon(notification.type)}
                      </div>
                      <div className="flex-grow">
                        <div className="flex justify-between items-start">
                          <p className={`text-sm ${notification.isRead ? 'text-muted-foreground' : 'text-foreground font-semibold'}`}>
                            {notification.content}
                          </p>
                          <Badge variant={notification.isRead ? "secondary" : "default"}>
                            {notification.type.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(notification.createdAt), 'PPp', { locale: de })}
                        </p>
                      </div>
                      <div className="flex-shrink-0 space-x-2">
                        {!notification.isRead && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => markAsRead(notification.id)}
                                className="hover:bg-primary/10"
                              >
                                <CheckCircle className="h-4 w-4 text-primary" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Als gelesen markieren</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => deleteNotification(notification.id)}
                              className="hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Löschen</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {filteredNotifications.length === 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                    className="text-center text-muted-foreground p-8 bg-card rounded-lg shadow-md"
                  >
                    <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-semibold">Keine Benachrichtigungen vorhanden</p>
                    <p className="mt-2">Wir informieren Sie, sobald es Neuigkeiten gibt.</p>
                  </motion.div>
                )}
              </div>
            </ScrollArea>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}