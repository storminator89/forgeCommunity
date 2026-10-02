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
        <div key={index} className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]">
          <Avatar className="row-span-2 h-9 w-9 sm:row-span-1">
            <AvatarImage src={activity.user.image || undefined} alt="Avatar" />
            <AvatarFallback>{activity.user.name?.slice(0, 2).toUpperCase() || 'UN'}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1 break-words">
            <p className="text-sm font-medium leading-none">{activity.user.name}</p>
            <p className="text-sm text-muted-foreground">
              {activity.action}
            </p>
          </div>
          <div className="col-start-2 text-xs text-muted-foreground sm:col-start-3">
            {formatDistanceToNow(new Date(activity.time), { addSuffix: true, locale: de })}
          </div>
        </div>
      ))}
    </div>
  );
}

