'use client'

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, BookOpen, Calendar, MessageSquare } from 'lucide-react';
import Link from 'next/link';

interface DashboardStats {
  totalUsers: number;
  totalCourses: number;
  totalEvents: number;
  totalPosts: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const { data: session } = useSession();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/admin/dashboard-stats');
        if (!response.ok) throw new Error('Failed to fetch dashboard stats');
        const data = await response.json();
        setStats(data);
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
      }
    };

    fetchStats();
  }, []);

  if (!session || session.user.role !== 'ADMIN') {
    return <div>Sie haben keine Berechtigung, diese Seite zu sehen.</div>;
  }

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <DashboardCard
          title="Benutzer"
          value={stats?.totalUsers}
          icon={Users}
          link="/admin/users"
        />
        <DashboardCard
          title="Kurse"
          value={stats?.totalCourses}
          icon={BookOpen}
          link="/admin/courses"
        />
        <DashboardCard
          title="Events"
          value={stats?.totalEvents}
          icon={Calendar}
          link="/admin/events"
        />
        <DashboardCard
          title="Beiträge"
          value={stats?.totalPosts}
          icon={MessageSquare}
          link="/admin/posts"
        />
      </div>
      {/* Hier können weitere Dashboard-Elemente hinzugefügt werden */}
    </div>
  );
}

interface DashboardCardProps {
  title: string;
  value: number | undefined;
  icon: React.ElementType;
  link: string;
}

function DashboardCard({ title, value, icon: Icon, link }: DashboardCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value !== undefined ? value : '...'}</div>
        <Link href={link} className="text-xs text-muted-foreground hover:underline">
          Verwalten
        </Link>
      </CardContent>
    </Card>
  );
}