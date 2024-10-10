"use client";

import { useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Menu, Send } from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
}

interface ChatConversation {
  id: string;
  name: string;
  lastMessage: string;
  unreadCount: number;
}

const mockConversations: ChatConversation[] = [
  { id: '1', name: 'Anna Schmidt', lastMessage: 'Wann ist das nächste Treffen?', unreadCount: 2 },
  { id: '2', name: 'Max Mustermann', lastMessage: 'Danke für die Infos!', unreadCount: 0 },
  { id: '3', name: 'Laura Weber', lastMessage: 'Können wir morgen telefonieren?', unreadCount: 1 },
  // Fügen Sie hier weitere Mock-Konversationen hinzu
];

const mockMessages: ChatMessage[] = [
  { id: '1', sender: 'Anna Schmidt', content: 'Hallo! Wie geht es dir?', timestamp: '10:30' },
  { id: '2', sender: 'Sie', content: 'Hi Anna! Mir geht es gut, danke. Wie läuft dein Projekt?', timestamp: '10:32' },
  { id: '3', sender: 'Anna Schmidt', content: 'Es läuft super! Wir machen gute Fortschritte.', timestamp: '10:35' },
  { id: '4', sender: 'Anna Schmidt', content: 'Wann ist eigentlich unser nächstes Teamtreffen?', timestamp: '10:36' },
  // Fügen Sie hier weitere Mock-Nachrichten hinzu
];

export default function ChatPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<ChatConversation | null>(mockConversations[0]);
  const [messages, setMessages] = useState<ChatMessage[]>(mockMessages);
  const [newMessage, setNewMessage] = useState('');

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const handleSendMessage = () => {
    if (newMessage.trim() !== '') {
      const newMsg: ChatMessage = {
        id: (messages.length + 1).toString(),
        sender: 'Sie',
        content: newMessage,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages([...messages, newMsg]);
      setNewMessage('');
    }
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
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">Chat</h2>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 flex overflow-hidden">
          <div className="w-64 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <ScrollArea className="h-full">
              {mockConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    selectedConversation?.id === conversation.id ? 'bg-gray-100 dark:bg-gray-700' : ''
                  }`}
                  onClick={() => setSelectedConversation(conversation)}
                >
                  <h3 className="font-semibold text-gray-900 dark:text-white">{conversation.name}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 truncate">{conversation.lastMessage}</p>
                  {conversation.unreadCount > 0 && (
                    <span className="inline-block bg-blue-500 text-white text-xs px-2 py-1 rounded-full mt-1">
                      {conversation.unreadCount}
                    </span>
                  )}
                </div>
              ))}
            </ScrollArea>
          </div>
          <div className="flex-1 flex flex-col">
            <ScrollArea className="flex-1 p-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`mb-4 ${
                    message.sender === 'Sie' ? 'text-right' : 'text-left'
                  }`}
                >
                  <div
                    className={`inline-block p-2 rounded-lg ${
                      message.sender === 'Sie'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                    }`}
                  >
                    <p>{message.content}</p>
                    <span className="text-xs opacity-75">{message.timestamp}</span>
                  </div>
                </div>
              ))}
            </ScrollArea>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex space-x-2">
                <Input
                  type="text"
                  placeholder="Schreiben Sie eine Nachricht..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                />
                <Button onClick={handleSendMessage}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}