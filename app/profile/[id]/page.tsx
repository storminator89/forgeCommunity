"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileEditor } from '@/components/profile/ProfileEditor';
import { ActivityFeed } from '@/components/profile/ActivityFeed';
import { ProjectsList } from '@/components/profile/ProjectsList';
import { CoursesList } from '@/components/profile/CoursesList';
import { FollowButton } from '@/components/profile/FollowButton';
import { FollowersList } from '@/components/profile/FollowersList';
import { toast } from 'react-toastify';
import {
  User,
  Mail,
  Calendar,
  MapPin,
  Briefcase,
  Award,
  Github,
  Linkedin,
  Twitter,
  Globe,
  Loader2,
  Users,
  MessageSquare,
  Plus,
  Settings,
  BookOpen,
  GraduationCap,
  Heart,
  Star,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { User as UserType, SocialLinks } from '@/types';

interface TabStats {
  [key: string]: {
    count: number;
    label: string;
    icon: React.ReactNode;
  };
}

const socialIcons = {
  github: <Github className="h-5 w-5" />,
  linkedin: <Linkedin className="h-5 w-5" />,
  twitter: <Twitter className="h-5 w-5" />,
  website: <Globe className="h-5 w-5" />
};

const socialLabels = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  twitter: 'Twitter',
  website: 'Website'
};

const socialColors = {
  github: 'hover:text-gray-900 dark:hover:text-white',
  linkedin: 'hover:text-blue-600',
  twitter: 'hover:text-blue-400',
  website: 'hover:text-green-500'
};

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [profile, setProfile] = useState<UserType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);

  const tabStats: TabStats = {
    overview: {
      count: 0,
      label: 'Übersicht',
      icon: <User className="h-4 w-4" />,
    },
    activity: {
      count: profile?.stats.posts || 0,
      label: 'Aktivität',
      icon: <MessageSquare className="h-4 w-4" />,
    },
    courses: {
      count: profile?.stats.courses || 0,
      label: profile?.role === 'INSTRUCTOR' ? 'Meine Kurse' : 'Eingeschriebene Kurse',
      icon: <BookOpen className="h-4 w-4" />,
    },
    teaching: {
      count: profile?.role === 'INSTRUCTOR' ? (profile?.stats.courses || 0) : 0,
      label: 'Unterricht',
      icon: <GraduationCap className="h-4 w-4" />,
    },
    projects: {
      count: profile?.stats.projects || 0,
      label: 'Projekte',
      icon: <Briefcase className="h-4 w-4" />,
    },
  };

  useEffect(() => {
    fetchProfile();
  }, [params.id]);

  const fetchProfile = async () => {
    try {
      const response = await fetch(`/api/users/${params.id}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch profile');
      }
      
      const data = await response.json();
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
      toast.error('Fehler beim Laden des Profils');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileUpdate = async (data: Partial<UserType>) => {
    try {
      setProfile(prev => prev ? { ...prev, ...data } : null);
      toast.success('Profil erfolgreich aktualisiert');
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Fehler beim Aktualisieren des Profils');
    }
  };

  const handleEndorse = async (skillId: string) => {
    if (!profile) return;

    try {
      const response = await fetch(`/api/users/${profile.id}/skills/${skillId}/endorse`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to endorse skill');
      }

      setProfile(prev => {
        if (!prev) return null;
        return {
          ...prev,
          skills: prev.skills.map(skill =>
            skill.id === skillId
              ? { ...skill, endorsements: skill.endorsements + 1 }
              : skill
          ),
        };
      });

      toast.success('Skill erfolgreich endorsed');
    } catch (error) {
      console.error('Error endorsing skill:', error);
      toast.error('Fehler beim Endorsen des Skills');
    }
  };

  const renderSocialLinks = () => {
    if (!profile?.socialLinks) return null;

    const hasLinks = Object.entries(profile.socialLinks).some(([_, value]) => value);
    if (!hasLinks) return null;

    return (
      <div className="flex flex-wrap gap-4 mt-6">
        {(Object.entries(profile.socialLinks) as [keyof typeof socialIcons, string][])
          .filter(([_, value]) => value)
          .map(([key, value]) => (
            <a
              key={key}
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${socialColors[key]}`}
            >
              {socialIcons[key]}
              <span className="text-sm font-medium">{socialLabels[key]}</span>
            </a>
          ))}
      </div>
    );
  };
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Profil nicht gefunden</h2>
          <p className="text-gray-500">Das angeforderte Profil existiert nicht.</p>
          <Button
            className="mt-4"
            onClick={() => router.push('/')}
          >
            Zurück zur Startseite
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-0">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Profil</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {/* Cover Image */}
          <div 
            className="h-48 bg-gradient-to-r from-blue-500 to-purple-600 bg-cover bg-center relative"
            style={profile.coverImage ? { backgroundImage: `url(${profile.coverImage})` } : undefined}
          />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
            <div className="relative -mt-16">
              {/* Profile Header Card */}
              <Card className="mb-6">
                <CardContent className="pt-6">
                  <div className="sm:flex sm:items-center sm:justify-between">
                    <div className="sm:flex sm:space-x-5">
                      <div className="relative flex-shrink-0">
                        <Avatar className="h-32 w-32 border-4 border-white dark:border-gray-800">
                          <AvatarImage src={profile.image || ''} alt={profile.name || ''} />
                          <AvatarFallback>
                            {profile.name?.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <div className="mt-4 sm:mt-0 sm:pt-1 sm:max-w-xl">
                        <div className="flex items-center">
                          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">
                            {profile.name}
                          </h1>
                          <Badge variant="outline" className="ml-3">
                            {profile.role}
                          </Badge>
                          {profile.isCurrentUser && (
                            <Badge variant="secondary" className="ml-2">
                              Das bin ich
                            </Badge>
                          )}
                        </div>
                        {profile.title && (
                          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">
                            {profile.title}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-4">
                          {profile.contact && (
                            <span className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                              <Mail className="h-4 w-4 mr-1" />
                              {profile.contact}
                            </span>
                          )}
                          <span className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                            <Calendar className="h-4 w-4 mr-1" />
                            Mitglied seit {format(new Date(profile.createdAt), 'MMMM yyyy', { locale: de })}
                          </span>
                          {profile.lastLogin && (
                            <span className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                              <User className="h-4 w-4 mr-1" />
                              Zuletzt aktiv {format(new Date(profile.lastLogin), 'dd.MM.yyyy HH:mm', { locale: de })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 sm:mt-0 flex flex-col sm:flex-row sm:space-x-3 space-y-3 sm:space-y-0">
                      {!profile.isCurrentUser && (
                        <FollowButton
                          userId={profile.id}
                          initialIsFollowing={profile.isFollowing}
                          userName={profile.name}
                          onFollowChange={(isFollowing) => {
                            setProfile(prev => prev ? {
                              ...prev,
                              isFollowing,
                              stats: {
                                ...prev.stats,
                                followers: prev.stats.followers + (isFollowing ? 1 : -1),
                              },
                            } : null);
                          }}
                        />
                      )}
                      {profile.isCurrentUser ? (
                        <Button
                          variant="outline"
                          onClick={() => setIsEditing(true)}
                          className="flex-1 sm:flex-none"
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          Einstellungen
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => router.push(`/messages/new?recipient=${profile.id}`)}
                          className="flex-1 sm:flex-none"
                        >
                          <MessageSquare className="mr-2 h-4 w-4" />
                          Nachricht
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
                    <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
                      <FollowersList
                        userId={profile.id}
                        count={profile.stats.followers}
                        type="followers"
                      />
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
                      <FollowersList
                        userId={profile.id}
                        count={profile.stats.following}
                        type="following"
                      />
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg text-center">
                      <div className="text-2xl font-bold">{profile.endorsements}</div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Endorsements</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg text-center">
                      <div className="text-2xl font-bold">{profile.stats.projects}</div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Projekte</p>
                    </div>
                  </div>

                  {/* Social Links */}
                  {renderSocialLinks()}
                </CardContent>
              </Card>

              {/* Profile Editor */}
              {profile.isCurrentUser && isEditing && (
                <ProfileEditor
                  profile={profile}
                  onUpdate={handleProfileUpdate}
                />
              )}

              {/* Main Content Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <TabsList className="w-full justify-start bg-white dark:bg-gray-800 p-1 rounded-lg shadow-sm">
                  {Object.entries(tabStats).map(([key, { label, count, icon }]) => (
                    <TabsTrigger
                      key={key}
                      value={key}
                      className="flex items-center space-x-2"
                      disabled={key === 'teaching' && profile.role !== 'INSTRUCTOR'}
                    >
                      {icon}
                      <span>{label}</span>
                      {count > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {count}
                        </Badge>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="overview">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Bio Section */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Über mich</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {profile.bio ? (
                          <p className="text-gray-600 dark:text-gray-300">{profile.bio}</p>
                        ) : (
                          <p className="text-gray-400 italic">
                            {profile.isCurrentUser 
                              ? 'Fügen Sie eine Biografie hinzu, um anderen von sich zu erzählen.'
                              : 'Keine Biografie vorhanden'}
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Skills Section */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Skills</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {profile.skills.length > 0 ? (
                            profile.skills.map((skill) => (
                              <div key={skill.id} className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="font-medium">{skill.name}</span>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-sm text-gray-500">
                                      {skill.endorsements} Endorsements
                                    </span>
                                    {!profile.isCurrentUser && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleEndorse(skill.id)}
                                        className="hover:text-red-500"
                                      >
                                        <Heart className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                <Progress value={skill.level} className="h-2" />
                              </div>
                            ))
                          ) : (
                            <p className="text-gray-400 italic">
                              {profile.isCurrentUser 
                                ? 'Fügen Sie Skills hinzu, um Ihre Fähigkeiten zu präsentieren.'
                                : 'Keine Skills vorhanden'}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Teaching Info für Instructors */}
                    {profile.role === 'INSTRUCTOR' && (
                      <Card className="md:col-span-2">
                        <CardHeader>
                          <CardTitle>Lehrtätigkeit</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                              <h4 className="font-medium mb-2">Unterrichtssprachen</h4>
                              <div className="flex flex-wrap gap-2">
                                {profile.teachingLanguages?.map((lang) => (
                                  <Badge key={lang} variant="secondary">
                                    {lang}
                                  </Badge>
                                )) || (
                                  <p className="text-gray-400 italic">
                                    Keine Unterrichtssprachen angegeben
                                  </p>
                                )}
                              </div>
                            </div>
                            <div>
                              <h4 className="font-medium mb-2">Expertise</h4>
                              <div className="flex flex-wrap gap-2">
                                {profile.expertise?.map((exp) => (
                                  <Badge key={exp} variant="secondary">
                                    {exp}
                                  </Badge>
                                )) || (
                                  <p className="text-gray-400 italic">
                                    Keine Expertise-Bereiche angegeben
                                  </p>
                                )}
                              </div>
                            </div>
                            {profile.averageRating && (
                              <div className="md:col-span-2">
                                <h4 className="font-medium mb-2">Bewertung als Instructor</h4>
                                <div className="flex items-center space-x-2">
                                  <div className="flex">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                      <Star
                                        key={star}
                                        className={`h-5 w-5 ${
                                          star <= profile.averageRating!
                                            ? 'text-yellow-400 fill-current'
                                            : 'text-gray-300'
                                        }`}
                                      />
                                    ))}
                                  </div>
                                  <span className="text-sm text-gray-500">
                                    ({profile.averageRating.toFixed(1)})
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="activity">
                  <ActivityFeed userId={profile.id} />
                </TabsContent>

                <TabsContent value="courses">
                  <CoursesList
                    userId={profile.id}
                    isInstructor={profile.role === 'INSTRUCTOR'}
                    showEnrolled={!profile.isCurrentUser || profile.role !== 'INSTRUCTOR'}
                  />
                </TabsContent>

                {profile.role === 'INSTRUCTOR' && (
                  <TabsContent value="teaching">
                    <CoursesList
                      userId={profile.id}
                      isInstructor={true}
                      showEnrolled={false}
                    />
                  </TabsContent>
                )}

                <TabsContent value="projects">
                  <ProjectsList
                    userId={profile.id}
                    isOwner={profile.isCurrentUser}
                  />
                </TabsContent>
                </Tabs>
            </div>
          </div>

          {/* Floating Action Button für Mobile */}
          {profile.isCurrentUser && !isEditing && (
            <div className="fixed bottom-6 right-6 md:hidden">
              <Button
                size="lg"
                className="rounded-full shadow-lg"
                onClick={() => setIsEditing(true)}
              >
                <Settings className="h-5 w-5" />
              </Button>
            </div>
          )}

          {/* Loading Overlay */}
          <AnimatePresence>
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm flex items-center justify-center z-50"
              >
                <Card className="w-[300px]">
                  <CardContent className="py-6">
                    <div className="flex flex-col items-center space-y-4">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      >
                        <Loader2 className="h-8 w-8 text-blue-500" />
                      </motion.div>
                      <p className="text-sm text-center">
                        Lade Profildaten...
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Toast Container */}
          <div className="fixed bottom-4 right-4 z-50">
            <AnimatePresence>
              {/* Toasts werden hier automatisch eingefügt */}
            </AnimatePresence>
          </div>

          {/* Back to Top Button */}
          <AnimatePresence>
            {typeof window !== 'undefined' && window.scrollY > 500 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="fixed bottom-6 right-6 z-40"
              >
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full shadow-lg"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    ↑
                  </motion.div>
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}