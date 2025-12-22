'use client'

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, BookOpen, Calendar, MessageSquare, AlertCircle, TrendingUp, Activity, DollarSign, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Skeleton } from "@/components/ui/skeleton";
import { RecentActivity } from "@/components/admin/RecentActivity";
import { Button } from "@/components/ui/button";
import dynamic from 'next/dynamic';

// const Overview = dynamic(() => import('@/components/admin/Overview').then(mod => mod.Overview), { ssr: false });

interface DashboardStats {
  totalUsers: number;
  totalCourses: number;
  totalEvents: number;
  totalPosts: number;
  userGrowth: any[];
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
        setError('Fehler beim Laden der Dashboard-Daten. Bitte versuchen Sie es später erneut.');
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
        <span>Sie haben keine Berechtigung, diese Seite zu sehen.</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <div className="flex items-center space-x-2">
          {/* <Button>Download Berichte</Button> */}
        </div>
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
          title="Gesamtbenutzer"
          value={stats?.totalUsers}
          icon={Users}
          link="/admin/users"
          isLoading={isLoading}
          trend="+20.1% zum Vormonat"
          descriptionClassName="text-emerald-500"
        />
        <DashboardCard
          title="Aktive Kurse"
          value={stats?.totalCourses}
          icon={BookOpen}
          link="/admin/courses"
          isLoading={isLoading}
          trend="+4 neu diesen Monat"
          descriptionClassName="text-muted-foreground"
        />
        <DashboardCard
          title="Geplante Events"
          value={stats?.totalEvents}
          icon={Calendar}
          link="/admin/events"
          isLoading={isLoading}
          trend="+12% seit letztem Monat"
          descriptionClassName="text-emerald-500"
        />
        <DashboardCard
          title="Beiträge"
          value={stats?.totalPosts}
          icon={MessageSquare}
          link="/admin/posts"
          isLoading={isLoading}
          trend="+573 diese Woche"
          descriptionClassName="text-muted-foreground"
        />
      </motion.div>

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-1">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Letzte Aktivitäten</CardTitle>
            <CardDescription>
              Die neuesten Aktionen in der Community.
            </CardDescription>
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
  trend?: string;
  descriptionClassName?: string;
}

function DashboardCard({ title, value, icon: Icon, link, isLoading, trend, descriptionClassName }: DashboardCardProps) {
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
              <Skeleton className="h-3 w-32" />
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold">{value !== undefined ? value.toLocaleString() : '...'}</div>
              {trend && (
                <p className={`text-xs ${descriptionClassName || 'text-muted-foreground'}`}>
                  {trend}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
