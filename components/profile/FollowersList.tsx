"use client";

import { useState, useEffect, useCallback, useEffectEvent, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import Link from 'next/link';

interface Follower {
  id: string;
  name: string;
  image: string | null;
  followedAt: string;
}

interface FollowersListProps {
  userId: string;
  count: number;
  type: 'followers' | 'following';
}

export function FollowersList({ userId, count, type }: FollowersListProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [users, setUsers] = useState<Follower[]>([]);
  const [loadedForKey, setLoadedForKey] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const requestKey = `${userId}:${type}`;

  const fetchUsers = useCallback(async (signal: AbortSignal, requestId: number) => {
    try {
      const response = await fetch(`/api/users/${userId}/${type}`, {
        credentials: 'include',
        signal,
      });

      if (!response.ok) throw new Error('Failed to fetch users');

      const data = await response.json();
      if (signal.aborted || requestIdRef.current !== requestId) return;
      setUsers(data.users);
      setLoadedForKey(requestKey);
    } catch (error) {
      if (signal.aborted || requestIdRef.current !== requestId) return;
      console.error(`Error fetching ${type}:`, error);
      setLoadedForKey(requestKey);
    } finally {
      if (!signal.aborted && requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [requestKey, type, userId]);

  const startFetch = useEffectEvent(() => {
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    void fetchUsers(controller.signal, requestId);
  });

  useEffect(() => {
    if (!isOpen) return;

    startFetch();

    return () => {
      activeControllerRef.current?.abort();
      requestIdRef.current += 1;
    };
  }, [isOpen, requestKey]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <Users className="h-4 w-4" />
          <span className="font-medium">{count}</span>
          <span className="text-gray-500">
            {type === 'followers' ? 'Follower' : 'Folge ich'}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {type === 'followers' ? 'Follower' : 'Folgt'}
          </DialogTitle>
          <DialogDescription>
            {type === 'followers'
              ? 'Benutzer, die diesem Profil folgen'
              : 'Benutzer, denen dieses Profil folgt'}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          {isLoading || loadedForKey !== requestKey ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {type === 'followers'
                ? 'Noch keine Follower'
                : 'Folgt niemandem'}
            </div>
          ) : (
            <div className="space-y-4">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Link
                    href={`/profile/${user.id}`}
                    className="flex items-center gap-3 flex-1"
                    onClick={() => setIsOpen(false)}
                  >
                    <Avatar>
                      <AvatarImage src={user.image || ''} alt={user.name} />
                      <AvatarFallback>
                        {user.name?.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{user.name}</p>
                      <p className="text-sm text-gray-500">
                        Folgt seit {format(new Date(user.followedAt), 'dd. MMMM yyyy', { locale: de })}
                      </p>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
