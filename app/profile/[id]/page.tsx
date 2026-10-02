"use client";

import { AppShell, AppHeader } from '@/components/app-shell';
import { useEffect, useState, useCallback, useRef } from 'react';
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
  Star,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { User as UserType, SocialLinks } from '@/types';
import { getSafeHttpUrl } from '@/lib/security';

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
  github: 'hover:text-foreground dark:hover:text-white',
  linkedin: 'hover:text-blue-600',
  twitter: 'hover:text-blue-400',
  website: 'hover:text-green-500'
};

export default function ProfilePage() {
  const { id: profileId } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const [profile, setProfile] = useState<UserType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [isEndorsing, setIsEndorsing] = useState(false);
  const [hasEndorsed, setHasEndorsed] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

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
    projects: {
      count: profile?.stats.projects || 0,
      label: 'Projekte',
      icon: <Briefcase className="h-4 w-4" />,
    },
  };

  const fetchProfile = useCallback(async () => {
    if (!profileId) {
      setIsLoading(false);
      return;
    }

    try {
      setHasEndorsed(false);
      const encodedProfileId = encodeURIComponent(profileId);
      const [response, socialResponse] = await Promise.all([
        fetch(`/api/users/${encodedProfileId}`, {
          credentials: 'include',
        }),
        fetch(`/api/users/${encodedProfileId}/social`, {
          credentials: 'include',
        }),
      ]);

      if (!response.ok) {
        throw new Error('Failed to fetch profile');
      }

      const data = await response.json();
      // The profile endpoint may return placeholder links while the dedicated
      // endpoint owns the persisted social link values.
      if (socialResponse.ok) {
        const socialData = await socialResponse.json();
        data.socialLinks = socialData.socialLinks ?? data.socialLinks;
      }
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
      toast.error('Fehler beim Laden des Profils');
    } finally {
      setIsLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    const fetchTimer = setTimeout(() => {
      void fetchProfile();
    }, 0);

    return () => clearTimeout(fetchTimer);
  }, [fetchProfile]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const updateBackToTopVisibility = () => {
      setShowBackToTop(main.scrollTop > 500);
    };

    updateBackToTopVisibility();
    main.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
    return () => main.removeEventListener('scroll', updateBackToTopVisibility);
  }, [isLoading]);

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

  const handleEndorseProfile = async () => {
    if (!profile || profile.isCurrentUser || hasEndorsed || isEndorsing) return;

    setIsEndorsing(true);
    try {
      const response = await fetch(`/api/members/${encodeURIComponent(profile.id)}/endorse`, {
        method: 'POST',
        credentials: 'include',
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to endorse profile');
      }

      setProfile(prev => {
        if (!prev) return null;
        return {
          ...prev,
          endorsements: prev.endorsements + 1,
        };
      });
      setHasEndorsed(true);

      toast.success('Profil erfolgreich empfohlen');
    } catch (error) {
      console.error('Error endorsing profile:', error);
      toast.error(error instanceof Error ? error.message : 'Fehler beim Empfehlen des Profils');
    } finally {
      setIsEndorsing(false);
    }
  };

  const renderSocialLinks = () => {
    if (!profile?.socialLinks) return null;

    const hasLinks = Object.values(profile.socialLinks).some(value => getSafeHttpUrl(value));
    if (!hasLinks) return null;

    return (
      <div className="flex flex-wrap gap-4 mt-6">
        {(Object.entries(profile.socialLinks) as [keyof typeof socialIcons, string][])
          .map(([key, value]) => [key, getSafeHttpUrl(value)] as const)
          .filter((entry): entry is readonly [keyof typeof socialIcons, string] => entry[1] !== null)
          .map(([key, value]) => (
            <a
              key={key}
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2 p-2 rounded-lg hover:bg-accent transition-colors ${socialColors[key]}`}
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
          <p className="text-muted-foreground">Das angeforderte Profil existiert nicht.</p>
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
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-foreground">Profil</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} ref={mainRef} className="flex-1 overflow-y-auto">
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
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0 sm:flex sm:gap-5">
                      <div className="relative flex-shrink-0">
                        <Avatar className="h-32 w-32 border-4 border-white dark:border-border">
                          <AvatarImage src={profile.image || ''} alt={profile.name || ''} />
                          <AvatarFallback>
                            {profile.name?.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <div className="mt-4 sm:mt-0 sm:pt-1 sm:max-w-xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <h1 className="text-2xl font-bold text-foreground sm:text-3xl break-words">
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
                          <p className="text-sm font-medium text-muted-foreground mt-1">
                            {profile.title}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-4">
                          {profile.contact && (
                            <span className="flex min-w-0 items-center text-sm text-muted-foreground break-all">
                              <Mail className="h-4 w-4 mr-1" />
                              {profile.contact}
                            </span>
                          )}
                          <span className="flex min-w-0 items-center text-sm text-muted-foreground break-all">
                            <Calendar className="h-4 w-4 mr-1" />
                            Mitglied seit {format(new Date(profile.createdAt), 'MMMM yyyy', { locale: de })}
                          </span>
                          {profile.lastLogin && (
                            <span className="flex min-w-0 items-center text-sm text-muted-foreground break-all">
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
                          initialIsFollowing={!!profile.isFollowing}
                          userName={profile.name || ''}
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
                          onClick={() => router.push('/chat')}
                          className="flex-1 sm:flex-none"
                        >
                          <MessageSquare className="mr-2 h-4 w-4" />
                          Chat öffnen
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                    <div className="bg-card dark:bg-muted/50 p-4 rounded-lg">
                      <FollowersList
                        userId={profile.id}
                        count={profile.stats.followers}
                        type="followers"
                      />
                    </div>
                    <div className="bg-card dark:bg-muted/50 p-4 rounded-lg">
                      <FollowersList
                        userId={profile.id}
                        count={profile.stats.following}
                        type="following"
                      />
                    </div>
                    <div className="bg-card dark:bg-muted/50 p-4 rounded-lg text-center">
                      <div className="text-2xl font-bold">{profile.endorsements}</div>
                      <p className="text-xs text-muted-foreground">Empfehlungen</p>
                      {!profile.isCurrentUser && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={handleEndorseProfile}
                          disabled={isEndorsing || hasEndorsed}
                        >
                          <Star className="mr-1 h-4 w-4" />
                          {hasEndorsed ? 'Bereits empfohlen' : isEndorsing ? 'Wird empfohlen…' : 'Profil empfehlen'}
                        </Button>
                      )}
                    </div>
                    <div className="bg-card dark:bg-muted/50 p-4 rounded-lg text-center">
                      <div className="text-2xl font-bold">{profile.stats.projects}</div>
                      <p className="text-xs text-muted-foreground">Projekte</p>
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
                <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-card p-1 rounded-lg shadow-sm">
                  {Object.entries(tabStats).map(([key, { label, count, icon }]) => (
                    <TabsTrigger
                      key={key}
                      value={key}
                      className="flex items-center space-x-2"
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
                          <p className="text-muted-foreground whitespace-pre-wrap break-words">{profile.bio}</p>
                        ) : (
                          <p className="text-muted-foreground italic">
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
                                    <span className="text-sm text-muted-foreground">
                                      {skill.endorsements} Empfehlungen
                                    </span>
                                  </div>
                                </div>
                                <Progress value={skill.level} className="h-2" />
                              </div>
                            ))
                          ) : (
                            <p className="text-muted-foreground italic">
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
                          <CardTitle>Expertise</CardTitle>
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
                                    <p className="text-muted-foreground italic">
                                      Keine Unterrichtssprachen angegeben
                                    </p>
                                  )}
                              </div>
                            </div>
                            <div>
                              <h4 className="font-medium mb-2">Fachgebiete</h4>
                              <div className="flex flex-wrap gap-2">
                                {profile.expertise?.map((exp) => (
                                  <Badge key={exp} variant="secondary">
                                    {exp}
                                  </Badge>
                                )) || (
                                    <p className="text-muted-foreground italic">
                                      Keine Fachgebiete angegeben
                                    </p>
                                  )}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="activity">
                  <ActivityFeed userId={profile.id} />
                </TabsContent>

                <TabsContent value="projects">
                  <ProjectsList
                    userId={profile.id}
                    isOwner={!!profile.isCurrentUser}
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
                  aria-label="Zurück nach oben"
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
            {showBackToTop && (
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
                  aria-label="Zurück nach oben"
                  onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
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
    </AppShell>
  );
}
