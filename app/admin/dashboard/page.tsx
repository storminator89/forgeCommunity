'use client'

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, BookOpen, Calendar, MessageSquare, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Skeleton } from "@/components/ui/skeleton";
import { RecentActivity } from "@/components/admin/RecentActivity";


interface DashboardStats {
  totalUsers: number;
  totalCourses: number;
  totalEvents: number;
  totalPosts: number;
  activities: any[];
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: session } = useSession();

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
        setError('Fehler beim Laden der Dashboard-Daten. Bitte versuche es erneut.');
        console.error('Error fetching dashboard stats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (!session || session.user.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-[50vh] text-destructive">
        <AlertCircle className="mr-2 h-5 w-5" />
        <span>Du hast keine Berechtigung für diese Seite.</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      </div>

      {error && (
        <div className="bg-destructive/15 text-destructive p-4 rounded-lg flex items-center border border-destructive/20">
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
          title="Benutzer"
          value={stats?.totalUsers}
          icon={Users}
          link="/admin/users"
          isLoading={isLoading}

        />
        <DashboardCard
          title="Kurse"
          value={stats?.totalCourses}
          icon={BookOpen}
          link="/courses"
          isLoading={isLoading}

        />
        <DashboardCard
          title="Events"
          value={stats?.totalEvents}
          icon={Calendar}
          link="/events"
          isLoading={isLoading}

        />
        <DashboardCard
          title="Beiträge"
          value={stats?.totalPosts}
          icon={MessageSquare}
          link="/community"
          isLoading={isLoading}

        />
      </motion.div>

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-1">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Letzte Aktivitäten</CardTitle>
          </CardHeader>
          <CardContent>
            <RecentActivity activities={stats?.activities} />
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
}

function DashboardCard({ title, value, icon: Icon, link, isLoading }: DashboardCardProps) {
  return (
    <Link href={link}>
      <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            {title}
          </CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-20" />
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold">{value !== undefined ? value.toLocaleString() : '—'}</div>
            </>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
