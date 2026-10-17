"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [loadError, setLoadError] = useState(false);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const requestKey = `${userId}:${type}`;

  const fetchUsers = useCallback(async (signal: AbortSignal, requestId: number) => {
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(userId)}/${type}`, {
        credentials: 'include',
        signal,
      });

      if (!response.ok) throw new Error('Failed to fetch users');

      const data = await response.json();
      if (signal.aborted || requestIdRef.current !== requestId) return;
      setUsers(data.users);
      setLoadError(false);
      setLoadedForKey(requestKey);
    } catch (error) {
      if (signal.aborted || requestIdRef.current !== requestId) return;
      console.error(`Error fetching ${type}:`, error);
      setLoadError(true);
      setLoadedForKey(requestKey);
    } finally {
      if (!signal.aborted && requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [requestKey, type, userId]);

  const startFetch = useCallback(() => {
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setLoadError(false);
    void fetchUsers(controller.signal, requestId);
  }, [fetchUsers]);

  useEffect(() => {
    if (!isOpen) return;

    const timer = window.setTimeout(startFetch, 0);

    return () => {
      window.clearTimeout(timer);
      activeControllerRef.current?.abort();
      requestIdRef.current += 1;
    };
  }, [isOpen, startFetch]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="flex min-h-11 w-full flex-col items-start gap-0.5 px-2 py-2 text-left hover:bg-accent"
        >
          <span className="text-2xl font-semibold tabular-nums">{count}</span>
          <span className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {type === 'followers' ? 'Follower' : 'Folge ich'}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {type === 'followers' ? 'Follower' : 'Folgt'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {type === 'followers'
              ? 'Benutzer, die diesem Profil folgen'
              : 'Benutzer, denen dieses Profil folgt'}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          {isLoading || loadedForKey !== requestKey ? (
            <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Liste wird geladen
            </div>
          ) : loadError ? (
            <div role="alert" className="space-y-3 py-6 text-center"><p>Die Liste konnte nicht geladen werden.</p><Button type="button" variant="outline" onClick={startFetch}>Erneut versuchen</Button></div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {type === 'followers'
                ? 'Noch keine Follower'
                : 'Folgt niemandem'}
            </div>
          ) : (
            <ul className="divide-y">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="py-2"
                >
                  <Link
                    href={`/profile/${encodeURIComponent(user.id)}`}
                    className="flex min-h-11 min-w-0 items-center gap-3 rounded-[10px] p-2 hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => setIsOpen(false)}
                  >
                    <Avatar>
                      <AvatarImage src={user.image || ''} alt={user.name} />
                      <AvatarFallback>
                        {user.name?.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium break-words">{user.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Folgt seit {format(new Date(user.followedAt), 'dd. MMMM yyyy', { locale: de })}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
