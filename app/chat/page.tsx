"use client"

import { useState, useEffect, useRef } from 'react'
import { Sidebar } from "@/components/Sidebar"
import { UserNav } from "@/components/user-nav"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Send, Hash, Search, Paperclip, Smile } from 'lucide-react'

interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
}

interface Channel {
  id: string;
  name: string;
}

const mockChannels: Channel[] = [
  { id: '1', name: 'Allgemein' },
  { id: '2', name: 'Entwicklung' },
  { id: '3', name: 'Design' },
  { id: '4', name: 'Marketing' },
];

const mockDirectMessages: { [key: string]: ChatMessage[] } = {
  'Anna Schmidt': [
    { id: '1', sender: 'Anna Schmidt', content: 'Hallo! Wie geht es dir?', timestamp: '10:30' },
    { id: '2', sender: 'Sie', content: 'Hi Anna! Mir geht es gut, danke. Wie läuft dein Projekt?', timestamp: '10:32' },
    { id: '3', sender: 'Anna Schmidt', content: 'Es läuft super! Wir machen gute Fortschritte.', timestamp: '10:35' },
    { id: '4', sender: 'Anna Schmidt', content: 'Wann ist eigentlich unser nächstes Teamtreffen?', timestamp: '10:36' },
  ],
  'Max Mustermann': [
    { id: '1', sender: 'Max Mustermann', content: 'Hey, hast du die neuen Designs gesehen?', timestamp: '11:00' },
    { id: '2', sender: 'Sie', content: 'Noch nicht, ich schaue gleich mal rein!', timestamp: '11:05' },
  ],
};

const mockChannelMessages: { [key: string]: ChatMessage[] } = {
  'Allgemein': [
    { id: '1', sender: 'System', content: 'Willkommen im Allgemeinen Channel!', timestamp: '09:00' },
    { id: '2', sender: 'Anna Schmidt', content: 'Hallo zusammen! Wie war euer Wochenende?', timestamp: '09:15' },
  ],
  'Entwicklung': [
    { id: '1', sender: 'Max Mustermann', content: 'Hat jemand Erfahrung mit GraphQL?', timestamp: '10:00' },
    { id: '2', sender: 'Laura Weber', content: 'Ja, ich habe es in meinem letzten Projekt verwendet. Was möchtest du wissen?', timestamp: '10:05' },
  ],
};

export default function ChatPage() {
  const [activeTab, setActiveTab] = useState<'channels' | 'direct'>('channels');
  const [selectedChannel, setSelectedChannel] = useState<Channel>(mockChannels[0]);
  const [selectedDirectMessage, setSelectedDirectMessage] = useState<string>('Anna Schmidt');
  const [messages, setMessages] = useState<ChatMessage[]>(mockChannelMessages[selectedChannel.name]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'channels') {
      setMessages(mockChannelMessages[selectedChannel.name] || []);
    } else {
      setMessages(mockDirectMessages[selectedDirectMessage] || []);
    }
  }, [activeTab, selectedChannel, selectedDirectMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
      <Sidebar className="hidden md:block" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{activeTab === 'channels' ? `# ${selectedChannel.name}` : selectedDirectMessage}</h2>
              <div className="hidden md:flex items-center space-x-2 text-gray-500 dark:text-gray-400">
                <span className="text-sm">3 Mitglieder</span>
                <span>•</span>
                <span className="text-sm">2 online</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Suchen..."
                  className="pl-8 pr-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
              </div>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 flex overflow-hidden">
          <div className="w-64 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hidden md:block">
            <Tabs defaultValue="channels" className="w-full" onValueChange={(value) => setActiveTab(value as 'channels' | 'direct')}>
              <TabsList className="w-full">
                <TabsTrigger value="channels" className="w-1/2">Channels</TabsTrigger>
                <TabsTrigger value="direct" className="w-1/2">Direkt</TabsTrigger>
              </TabsList>
              <TabsContent value="channels">
                <ScrollArea className="h-[calc(100vh-10rem)]">
                  {mockChannels.map((channel) => (
                    <div
                      key={channel.id}
                      className={`p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        selectedChannel.id === channel.id ? 'bg-gray-200 dark:bg-gray-600' : ''
                      }`}
                      onClick={() => setSelectedChannel(channel)}
                    >
                      <div className="flex items-center space-x-3">
                        <Hash className="h-5 w-5 text-gray-500" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{channel.name}</span>
                      </div>
                    </div>
                  ))}
                </ScrollArea>
              </TabsContent>
              <TabsContent value="direct">
                <ScrollArea className="h-[calc(100vh-10rem)]">
                  {Object.keys(mockDirectMessages).map((name) => (
                    <div
                      key={name}
                      className={`p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        selectedDirectMessage === name ? 'bg-gray-200 dark:bg-gray-600' : ''
                      }`}
                      onClick={() => setSelectedDirectMessage(name)}
                    >
                      <div className="flex items-center space-x-3">
                        <Avatar>
                          <AvatarFallback>{name[0]}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{name}</span>
                      </div>
                    </div>
                  ))}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
          <div className="flex-1 flex flex-col bg-white dark:bg-gray-900">
            <ScrollArea className="flex-1 p-4">
              {messages.map((message, index) => (
                <div
                  key={message.id}
                  className={`flex ${message.sender === 'Sie' ? 'justify-end' : 'justify-start'} mb-4`}
                >
                  {message.sender !== 'Sie' && (index === 0 || messages[index - 1].sender !== message.sender) && (
                    <Avatar className="mr-2 mt-1">
                      <AvatarFallback>{message.sender[0]}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className={`flex flex-col ${message.sender === 'Sie' ? 'items-end' : 'items-start'}`}>
                    {(index === 0 || messages[index - 1].sender !== message.sender) && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">{message.sender}</span>
                    )}
                    <div
                      className={`rounded-2xl px-4 py-2 max-w-md ${
                        message.sender === 'Sie'
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">{message.timestamp}</span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </ScrollArea>
            <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-2">
                <Button variant="ghost" size="icon">
                  <Paperclip className="h-5 w-5 text-gray-500" />
                </Button>
                <Input
                  type="text"
                  placeholder="Schreiben Sie eine Nachricht..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="flex-grow"
                />
                <Button variant="ghost" size="icon">
                  <Smile className="h-5 w-5 text-gray-500" />
                </Button>
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