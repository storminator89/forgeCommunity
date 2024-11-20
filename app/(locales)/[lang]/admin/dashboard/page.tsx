'use client'

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, BookOpen, Calendar, MessageSquare, AlertCircle, TrendingUp, Activity } from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Skeleton } from "@/components/ui/skeleton";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { getDictionary } from "@/i18n/getDictionary";
import { useParams } from "next/navigation";
import { LoadingSpinner } from "@/components/loading-spinner";

interface DashboardStats {
  totalUsers: number;
  totalCourses: number;
  totalEvents: number;
  totalPosts: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: session } = useSession();
  const params = useParams();
  const [dict, setDict] = useState<any>(null);
  const lang = params?.lang as string;

  useEffect(() => {
    const loadDictionary = async () => {
      const dictionary = await getDictionary(lang);
      setDict(dictionary);
    };
    loadDictionary();
  }, [lang]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch('/api/admin/dashboard-stats');
        if (!response.ok) throw new Error('Failed to fetch dashboard stats');
        const data = await response.json();
        setStats(data);
      } catch (error) {
        setError(dict?.admin.dashboard.error);
        console.error('Error fetching dashboard stats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (dict) {
      fetchStats();
    }
  }, [dict]);

  if (!dict) return <LoadingSpinner />;

  if (!session || session.user.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-[50vh] text-red-600">
        <AlertCircle className="mr-2 h-5 w-5" />
        <span>{dict.admin.dashboard.noPermission}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{dict.admin.dashboard.title}</h1>
        <p className="text-muted-foreground">
          {dict.admin.dashboard.subtitle}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center">
          <AlertCircle className="mr-2 h-5 w-5" />
          {error}
        </div>
      )}

      <motion.div 
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <DashboardCard
          title={dict.admin.dashboard.cards.users}
          value={stats?.totalUsers}
          icon={Users}
          link={`/${lang}/admin/users`}
          isLoading={isLoading}
          trend="+12% ↑"
          showDetails={dict.admin.dashboard.cards.showDetails}
        />
        <DashboardCard
          title={dict.admin.dashboard.cards.courses}
          value={stats?.totalCourses}
          icon={BookOpen}
          link={`/${lang}/admin/courses`}
          isLoading={isLoading}
          trend="+5% ↑"
          showDetails={dict.admin.dashboard.cards.showDetails}
        />
        <DashboardCard
          title={dict.admin.dashboard.cards.events}
          value={stats?.totalEvents}
          icon={Calendar}
          link={`/${lang}/admin/events`}
          isLoading={isLoading}
          trend="+8% ↑"
          showDetails={dict.admin.dashboard.cards.showDetails}
        />
        <DashboardCard
          title={dict.admin.dashboard.cards.posts}
          value={stats?.totalPosts}
          icon={MessageSquare}
          link={`/${lang}/admin/posts`}
          isLoading={isLoading}
          trend="+15% ↑"
          showDetails={dict.admin.dashboard.cards.showDetails}
        />
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Activity className="mr-2 h-4 w-4" />
              {dict.admin.dashboard.sections.recentActivity}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Aktivitätsliste hier */}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <TrendingUp className="mr-2 h-4 w-4" />
              {dict.admin.dashboard.sections.trends}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Trends hier */}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface DashboardCardProps {
  title: string;
  value: number | undefined;
  icon: React.ElementType;
  link: string;
  isLoading: boolean;
  trend?: string;
  showDetails: string;
}

function DashboardCard({ title, value, icon: Icon, link, isLoading, trend, showDetails }: DashboardCardProps) {
  return (
    <Link href={link}>
      <Card className="transition-all duration-300 hover:scale-105 hover:shadow-lg cursor-pointer bg-white dark:bg-gray-800">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <>
              <div className="text-2xl font-bold">{value !== undefined ? value.toLocaleString() : '...'}</div>
              {trend && (
                <p className="text-xs text-green-500 mt-1">
                  {trend}
                </p>
              )}
            </>
          )}
          <p className="text-xs text-muted-foreground mt-1 hover:underline">
            {showDetails} →
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
