"use client";

import { useState, useEffect } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Menu, Bell, MessageSquare, Calendar, Book, CheckCircle, Trash2 } from 'lucide-react';

interface Notification {
  id: string;
  type: 'message' | 'event' | 'course' | 'system';
  content: string;
  timestamp: string;
  isRead: boolean;
}

const mockNotifications: Notification[] = [
  { id: '1', type: 'message', content: 'Neue Nachricht von Anna Schmidt', timestamp: '2024-03-15T10:30:00', isRead: false },
  { id: '2', type: 'event', content: 'Erinnerung: Webentwicklung Workshop morgen', timestamp: '2024-03-14T15:00:00', isRead: false },
  { id: '3', type: 'course', content: 'Neuer Kurs verfügbar: Advanced React Techniques', timestamp: '2024-03-13T09:00:00', isRead: true },
  { id: '4', type: 'system', content: 'Ihr Konto wurde erfolgreich aktualisiert', timestamp: '2024-03-12T14:45:00', isRead: true },
];

export default function NotificationsPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const markAsRead = (id: string) => {
    setNotifications(notifications.map(notif => 
      notif.id === id ? { ...notif, isRead: true } : notif
    ));
  };

  const deleteNotification = (id: string) => {
    setNotifications(notifications.filter(notif => notif.id !== id));
  };

  const getIcon = (type: string) => {
    switch(type) {
      case 'message': return <MessageSquare className="h-5 w-5 text-blue-500" />;
      case 'event': return <Calendar className="h-5 w-5 text-green-500" />;
      case 'course': return <Book className="h-5 w-5 text-purple-500" />;
      default: return <Bell className="h-5 w-5 text-gray-500" />;
    }
  };

  const formatDate = (dateString: string) => {
    if (!isClient) return dateString; // Return unformatted string on server
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar isOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />
      <div className="flex-1 flex flex-col">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-40 sticky top-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center">
              <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={toggleSidebar}>
                <Menu className="h-6 w-6" />
              </Button>
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">Benachrichtigungen</h2>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4 lg:p-8">
            <div className="max-w-2xl mx-auto space-y-4">
              {notifications.map((notification) => (
                <div 
                  key={notification.id} 
                  className={`bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md flex items-start space-x-4 ${
                    !notification.isRead ? 'border-l-4 border-blue-500' : ''
                  }`}
                >
                  <div className="flex-shrink-0">
                    {getIcon(notification.type)}
                  </div>
                  <div className="flex-grow">
                    <p className={`text-sm ${notification.isRead ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-white font-semibold'}`}>
                      {notification.content}
                    </p>
                    <p className="text-xs text-gray-500 mt-1" suppressHydrationWarning>
                      {formatDate(notification.timestamp)}
                    </p>
                  </div>
                  <div className="flex-shrink-0 space-x-2">
                    {!notification.isRead && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => markAsRead(notification.id)}
                      >
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => deleteNotification(notification.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
              {notifications.length === 0 && (
                <div className="text-center text-gray-500 dark:text-gray-400">
                  Keine Benachrichtigungen vorhanden.
                </div>
              )}
            </div>
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}