'use client'

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  UserPlus,
  RefreshCw,
  MoreHorizontal,
  Search,
  UserCog,
  Trash2,
  Users,
  Mail,
  Calendar,
  Award,
  Activity,
  BookOpen,
  MessageSquare,
  Heart,
  Star,
  Shield
} from 'lucide-react';
import AddUserDialog from './AddUserDialog';
import { EditUserDialog } from './EditUserDialog';
import { AnimatePresence, motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sidebar } from "@/components/Sidebar";

interface UserSettings {
  emailNotifications: boolean;
  pushNotifications: boolean;
  theme: 'LIGHT' | 'DARK';
  language: string;
}

interface UserStats {
  postsCount: number;
  commentsCount: number;
  likesReceived: number;
  skillsCount: number;
  endorsementsReceived: number;
  coursesEnrolled: number;
  coursesCompleted: number;
  projectsCount: number;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MODERATOR' | 'USER' | 'INSTRUCTOR';
  createdAt: string;
  image?: string | null;
  bio?: string | null;
  title?: string;
  contact?: string;
  endorsements: number;
  lastLogin?: string | null;
  emailVerified?: string | null;
  settings?: UserSettings;
  stats?: UserStats;
  badges?: { name: string; awardedAt: string }[];
  skills?: { name: string; level: number }[];
}

interface UserManagementProps {
  dict: any;
  lang: string;
}

export default function UserManagement({ dict, lang }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push(`/${lang}`);
    }
  }, [status, router, lang]);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch users');
      }

      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error(dict.admin.users.error.loadUsers);
    } finally {
      setIsLoading(false);
    }
  };


  const handleAddUser = (newUser: User) => {
    setUsers([...users, newUser]);
    setIsAddUserOpen(false);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
  };

  const handleUpdateUser = (updatedUser: User) => {
    setUsers(users.map(user => user.id === updatedUser.id ? updatedUser : user));
    setEditingUser(null);
    if (selectedUser?.id === updatedUser.id) {
      setSelectedUser(updatedUser);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm(dict.admin.users.deleteConfirm)) {
      return;
    }
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(dict.admin.users.error.deleteUser);
      setUsers(users.filter(user => user.id !== userId));
      if (selectedUser?.id === userId) {
        setSelectedUser(null);
      }
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'destructive';
      case 'MODERATOR':
        return 'warning';
      case 'INSTRUCTOR':
        return 'purple';
      default:
        return 'default';
    }
  };

  const getVerificationStatus = (user: User) => {
    if (user.emailVerified) {
      return <Badge variant="success">{dict.common.status.verified}</Badge>;
    }
    return <Badge variant="secondary">{dict.common.status.notVerified}</Badge>;
  };

  const getLastActiveStatus = (user: User) => {
    if (!user.lastLogin) {
      return dict.common.status.neverLoggedIn;
    }

    try {
      const lastLogin = new Date(user.lastLogin);
      const now = new Date();
      const diffMinutes = Math.floor((now.getTime() - lastLogin.getTime()) / (1000 * 60));
      const diffHours = Math.floor(diffMinutes / 60);
      const diffDays = Math.floor(diffHours / 24);

      console.log('Last login details:', { // Debug-Log
        lastLogin,
        diffMinutes,
        diffHours,
        diffDays
      });

      if (diffMinutes < 5) return dict.common.status.justActive;
      if (diffMinutes < 60) return `${diffMinutes} ${dict.common.status.minutesAgo}`;
      if (diffHours < 24) return `${diffHours} ${dict.common.status.hoursAgo}`;
      if (diffDays === 1) return dict.common.status.yesterday;

      return `${dict.common.status.lastActiveAt} ${lastLogin.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US')} ${dict.common.status.at} ${lastLogin.toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit'
      })}`;
    } catch (error) {
      console.error('Error formatting lastLogin:', error);
      return dict.common.status.errorLoadingLastLogin;
    }
  };


  const filteredUsers = users.filter(user =>
    user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.title?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (status === 'loading' || isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center ml-12 lg:ml-0">
                <Users className="mr-2 h-6 w-6" />
                {dict.navigation.userManagement}
              </h2>
              <div className="flex items-center space-x-4">
                <ThemeToggle />
                <UserNav />
              </div>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Hauptbereich - Benutzerliste */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="bg-white dark:bg-gray-800">
                <CardHeader>
                  <CardTitle className="text-gray-900 dark:text-gray-100 flex items-center justify-between">
                    <span>{dict.navigation.userManagement}</span>
                    <Button onClick={() => setIsAddUserOpen(true)}>
                      <UserPlus className="mr-2 h-4 w-4" />
                      {dict.common.add}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex items-center space-x-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <Input
                        type="text"
                        placeholder={dict.common.search}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 pr-4 py-2 w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={fetchUsers}
                      className="dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {dict.common.refresh}
                    </Button>
                  </div>

                  <div className="rounded-md border dark:border-gray-700">
                    <Table>
                      <TableHeader>
                        <TableRow className="dark:border-gray-700">
                          <TableHead className="dark:text-gray-300">{dict.common.user}</TableHead>
                          <TableHead className="dark:text-gray-300">{dict.common.contact}</TableHead>
                          <TableHead className="dark:text-gray-300">{dict.common.statusLabel}</TableHead>
                          <TableHead className="dark:text-gray-300">{dict.common.activity}</TableHead>
                          <TableHead className="text-right dark:text-gray-300">{dict.common.actions}</TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        <AnimatePresence>
                          {filteredUsers.map((user) => (
                            <motion.tr
                              key={user.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                              onClick={() => setSelectedUser(user)}
                            >
                              <TableCell className="dark:text-gray-300">
                                <div className="flex items-center space-x-3">
                                  <Avatar className="h-10 w-10">
                                    <AvatarImage src={user.image || ''} alt={user.name || ''} />
                                    <AvatarFallback>{user.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                                  </Avatar>
                                  <div>
                                    <div className="font-medium">{user.name}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">{user.title || dict.admin.users.noTitle}</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="dark:text-gray-300">
                                <div className="text-sm">
                                  <div className="flex items-center space-x-1">
                                    <Mail className="h-4 w-4 text-gray-500" />
                                    <span>{user.email}</span>
                                  </div>
                                  {user.contact && (
                                    <div className="text-gray-500 mt-1">
                                      {user.contact}
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  <Badge variant={getRoleBadgeVariant(user.role)}>
                                    {user.role}
                                  </Badge>
                                  <div>{getVerificationStatus(user)}</div>
                                </div>
                              </TableCell>
                              <TableCell className="dark:text-gray-300">
                                <div className="text-sm">
                                  <div>{getLastActiveStatus(user)}</div>
                                  <div className="text-gray-500 dark:text-gray-400 text-xs mt-1">
                                    {dict.admin.users.registeredAt} {new Date(user.createdAt).toLocaleDateString('de-DE')}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 p-0 dark:text-gray-300 dark:hover:bg-gray-700">
                                      <span className="sr-only">{dict.admin.users.menu.open}</span>
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="dark:bg-gray-800 dark:border-gray-700">
                                    <DropdownMenuLabel className="dark:text-gray-300">{dict.common.actions}</DropdownMenuLabel>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleEditUser(user);
                                      }}
                                      className="dark:hover:bg-gray-700"
                                    >
                                      <UserCog className="mr-2 h-4 w-4" />
                                      {dict.common.edit}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="dark:border-gray-700" />
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteUser(user.id);
                                      }}
                                      className="text-red-600 dark:text-red-400 dark:hover:bg-gray-700"
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      {dict.common.delete}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </motion.tr>
                          ))}
                        </AnimatePresence>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Seitenleiste - Benutzerdetails und Statistiken */}
            <div className="space-y-6">
              {selectedUser ? (
                <>
                  {/* Benutzerdetails */}
                  <Card className="bg-white dark:bg-gray-800">
                    <CardHeader>
                      <CardTitle className="text-gray-900 dark:text-gray-100">{dict.admin.users.details.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col items-center space-y-4">
                        <Avatar className="h-20 w-20">
                          <AvatarImage src={selectedUser.image || ''} alt={selectedUser.name || ''} />
                          <AvatarFallback>{selectedUser.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="text-center">
                          <h3 className="text-lg font-semibold dark:text-gray-100">{selectedUser.name}</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{selectedUser.title}</p>
                        </div>
                      </div>

                      <Tabs defaultValue="overview" className="mt-6">
                        <TabsList className="grid grid-cols-4 gap-4">
                          <TabsTrigger value="overview">{dict.admin.users.tabs.overview}</TabsTrigger>
                          <TabsTrigger value="activity">{dict.admin.users.tabs.activity}</TabsTrigger>
                          <TabsTrigger value="skills">{dict.admin.users.tabs.skills}</TabsTrigger>
                          <TabsTrigger value="settings">{dict.admin.users.tabs.settings}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="overview" className="mt-4 space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <div className="text-sm text-gray-500 dark:text-gray-400">{dict.admin.users.details.registeredAt}</div>
                              <div className="dark:text-gray-300">
                                {new Date(selectedUser.createdAt).toLocaleDateString('de-DE')}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="text-sm text-gray-500 dark:text-gray-400">{dict.admin.users.details.lastActivity}</div>
                              <div className="dark:text-gray-300">
                                {selectedUser.lastLogin ? new Date(selectedUser.lastLogin).toLocaleDateString('de-DE') : dict.admin.users.details.neverLoggedIn}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="text-sm text-gray-500 dark:text-gray-400">{dict.admin.users.details.emailStatus}</div>
                              <div>{getVerificationStatus(selectedUser)}</div>
                            </div>
                            <div className="space-y-2">
                              <div className="text-sm text-gray-500 dark:text-gray-400">{dict.admin.users.details.role}</div>
                              <Badge variant={getRoleBadgeVariant(selectedUser.role)}>
                                {selectedUser.role}
                              </Badge>
                            </div>
                          </div>

                          {selectedUser.bio && (
                            <div className="space-y-2">
                              <div className="text-sm text-gray-500 dark:text-gray-400">{dict.admin.users.details.bio}</div>
                              <p className="text-sm dark:text-gray-300">{selectedUser.bio}</p>
                            </div>
                          )}

                          {selectedUser.badges && selectedUser.badges.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-sm text-gray-500 dark:text-gray-400">{dict.admin.users.details.badges}</div>
                              <div className="flex flex-wrap gap-2">
                                {selectedUser.badges.map((badge, index) => (
                                  <Badge key={index} variant="outline" className="dark:border-gray-600">
                                    <Award className="w-3 h-3 mr-1" />
                                    {badge.name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </TabsContent>

                        <TabsContent value="activity" className="mt-4 space-y-4">
                          {selectedUser.stats && (
                            <div className="grid grid-cols-2 gap-4">
                              <Card className="bg-gray-50 dark:bg-gray-700">
                                <CardContent className="pt-6">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{dict.admin.users.stats.posts}</p>
                                      <p className="text-2xl font-bold dark:text-gray-100">{selectedUser.stats.postsCount}</p>
                                    </div>
                                    <BookOpen className="h-8 w-8 text-gray-400" />
                                  </div>
                                </CardContent>
                              </Card>

                              <Card className="bg-gray-50 dark:bg-gray-700">
                                <CardContent className="pt-6">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{dict.admin.users.stats.comments}</p>
                                      <p className="text-2xl font-bold dark:text-gray-100">{selectedUser.stats.commentsCount}</p>
                                    </div>
                                    <MessageSquare className="h-8 w-8 text-gray-400" />
                                  </div>
                                </CardContent>
                              </Card>

                              <Card className="bg-gray-50 dark:bg-gray-700">
                                <CardContent className="pt-6">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{dict.admin.users.stats.likesReceived}</p>
                                      <p className="text-2xl font-bold dark:text-gray-100">{selectedUser.stats.likesReceived}</p>
                                    </div>
                                    <Heart className="h-8 w-8 text-gray-400" />
                                  </div>
                                </CardContent>
                              </Card>

                              <Card className="bg-gray-50 dark:bg-gray-700">
                                <CardContent className="pt-6">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{dict.admin.users.stats.endorsements}</p>
                                      <p className="text-2xl font-bold dark:text-gray-100">{selectedUser.endorsements}</p>
                                    </div>
                                    <Star className="h-8 w-8 text-gray-400" />
                                  </div>
                                </CardContent>
                              </Card>

                              <Card className="bg-gray-50 dark:bg-gray-700">
                                <CardContent className="pt-6">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{dict.admin.users.stats.courses}</p>
                                      <p className="text-2xl font-bold dark:text-gray-100">
                                        {selectedUser.stats.coursesCompleted} / {selectedUser.stats.coursesEnrolled}
                                      </p>
                                    </div>
                                    <Activity className="h-8 w-8 text-gray-400" />
                                  </div>
                                </CardContent>
                              </Card>

                              <Card className="bg-gray-50 dark:bg-gray-700">
                                <CardContent className="pt-6">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{dict.admin.users.stats.projects}</p>
                                      <p className="text-2xl font-bold dark:text-gray-100">{selectedUser.stats.projectsCount}</p>
                                    </div>
                                    <Shield className="h-8 w-8 text-gray-400" />
                                  </div>
                                </CardContent>
                              </Card>
                            </div>
                          )}
                        </TabsContent>

                        <TabsContent value="skills" className="mt-4">
                          {selectedUser.skills && selectedUser.skills.length > 0 ? (
                            <div className="space-y-4">
                              {selectedUser.skills.map((skill, index) => (
                                <div key={index} className="flex items-center justify-between">
                                  <span className="text-sm font-medium dark:text-gray-300">{skill.name}</span>
                                  <div className="w-32">
                                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
                                      <div
                                        className="h-2 bg-blue-500 rounded-full"
                                        style={{ width: `${skill.level}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
                              {dict.admin.users.noSkills}
                            </div>
                          )}
                        </TabsContent>

                        <TabsContent value="settings" className="mt-4 space-y-4">
                          {selectedUser.settings && (
                            <>
                              <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="space-y-0.5">
                                    <div className="text-sm font-medium dark:text-gray-300">{dict.admin.users.settings.emailNotifications}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                      {dict.admin.users.settings.receivesEmailNotifications}
                                    </div>
                                  </div>
                                  <Badge variant={selectedUser.settings.emailNotifications ? "success" : "secondary"}>
                                    {selectedUser.settings.emailNotifications ? dict.admin.users.settings.enabled : dict.admin.users.settings.disabled}
                                  </Badge>
                                </div>

                                <div className="flex items-center justify-between">
                                  <div className="space-y-0.5">
                                    <div className="text-sm font-medium dark:text-gray-300">{dict.admin.users.settings.pushNotifications}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                      {dict.admin.users.settings.receivesPushNotifications}
                                    </div>
                                  </div>
                                  <Badge variant={selectedUser.settings.pushNotifications ? "success" : "secondary"}>
                                    {selectedUser.settings.pushNotifications ? dict.admin.users.settings.enabled : dict.admin.users.settings.disabled}
                                  </Badge>
                                </div>

                                <div className="flex items-center justify-between">
                                  <div className="space-y-0.5">
                                    <div className="text-sm font-medium dark:text-gray-300">{dict.admin.users.settings.theme}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                      {dict.admin.users.settings.preferredTheme}
                                    </div>
                                  </div>
                                  <Badge>
                                    {selectedUser.settings.theme}
                                  </Badge>
                                </div>

                                <div className="flex items-center justify-between">
                                  <div className="space-y-0.5">
                                    <div className="text-sm font-medium dark:text-gray-300">{dict.admin.users.settings.language}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                      {dict.admin.users.settings.preferredLanguage}
                                    </div>
                                  </div>
                                  <Badge>
                                    {selectedUser.settings.language.toUpperCase()}
                                  </Badge>
                                </div>
                              </div>
                            </>
                          )}
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                </>
              ) : (

                // Statistik-Karte, wenn kein Benutzer ausgewählt ist
                <Card className="bg-white dark:bg-gray-800">
                  <CardHeader>
                    <CardTitle className="text-gray-900 dark:text-gray-100">{dict.admin.users.stats.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between dark:text-gray-300">
                        <span>{dict.admin.users.stats.totalUsers}</span>
                        <span className="font-semibold">{users.length}</span>
                      </div>
                      <div className="flex justify-between dark:text-gray-300">
                        <span>{dict.admin.users.stats.admins}</span>
                        <span className="font-semibold">
                          {users.filter(u => u.role === 'ADMIN').length}
                        </span>
                      </div>
                      <div className="flex justify-between dark:text-gray-300">
                        <span>{dict.admin.users.stats.moderators}</span>
                        <span className="font-semibold">
                          {users.filter(u => u.role === 'MODERATOR').length}
                        </span>
                      </div>
                      <div className="flex justify-between dark:text-gray-300">
                        <span>{dict.admin.users.stats.instructors}</span>
                        <span className="font-semibold">
                          {users.filter(u => u.role === 'INSTRUCTOR').length}
                        </span>
                      </div>
                      <div className="flex justify-between dark:text-gray-300">
                        <span>{dict.admin.users.stats.normalUsers}</span>
                        <span className="font-semibold">
                          {users.filter(u => u.role === 'USER').length}
                        </span>
                      </div>
                      <div className="pt-4 border-t dark:border-gray-700">
                        <div className="flex justify-between dark:text-gray-300">
                          <span>{dict.admin.users.stats.verifiedUsers}</span>
                          <span className="font-semibold">
                            {users.filter(u => u.emailVerified).length}
                          </span>
                        </div>
                        <div className="flex justify-between dark:text-gray-300 mt-2">
                          <span>{dict.admin.users.stats.activeUsers}</span>
                          <span className="font-semibold">
                            {users.filter(u => {
                              if (!u.lastLogin) return false;
                              const thirtyDaysAgo = new Date();
                              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                              return new Date(u.lastLogin) > thirtyDaysAgo;
                            }).length}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dialoge */}
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onUpdate={handleUpdateUser}
          dict={dict}
        />
      )}

      {isAddUserOpen && (
        <AddUserDialog
          onClose={() => setIsAddUserOpen(false)}
          onAdd={handleAddUser}
          dict={dict}
        />
      )}
    </div>
  );
}
