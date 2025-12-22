"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

interface Activity {
  type: string;
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
  action: string;
  time: string;
}

interface RecentActivityProps {
  activities?: Activity[];
}

export function RecentActivity({ activities = [] }: RecentActivityProps) {
  if (activities.length === 0) {
    return <div className="text-sm text-muted-foreground">Keine Aktivitäten gefunden.</div>;
  }

  return (
    <div className="space-y-8">
      {activities.map((activity, index) => (
        <div key={index} className="flex items-center">
          <Avatar className="h-9 w-9">
            <AvatarImage src={activity.user.image || undefined} alt="Avatar" />
            <AvatarFallback>{activity.user.name?.slice(0, 2).toUpperCase() || 'UN'}</AvatarFallback>
          </Avatar>
          <div className="ml-4 space-y-1">
            <p className="text-sm font-medium leading-none">{activity.user.name}</p>
            <p className="text-sm text-muted-foreground">
              {activity.action}
            </p>
          </div>
          <div className="ml-auto font-medium text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(activity.time), { addSuffix: true, locale: de })}
          </div>
        </div>
      ))}
    </div>
  );
}

