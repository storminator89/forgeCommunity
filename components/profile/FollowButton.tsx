"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Users, Plus, Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FollowButtonProps {
  userId: string;
  initialIsFollowing: boolean;
  userName: string;
  onFollowChange?: (isFollowing: boolean) => void;
}

export function FollowButton({ 
  userId, 
  initialIsFollowing, 
  userName,
  onFollowChange 
}: FollowButtonProps) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [isLoading, setIsLoading] = useState(false);

  const handleFollowClick = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/users/${userId}/follow`, {
        method: isFollowing ? 'DELETE' : 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to update follow status');
      }

      const data = await response.json();
      setIsFollowing(!isFollowing);
      onFollowChange?.(!isFollowing);
      
      toast.success(data.message || (isFollowing 
        ? `Sie folgen ${userName} nicht mehr` 
        : `Sie folgen jetzt ${userName}`));
    } catch (error) {
      console.error('Error updating follow status:', error);
      toast.error('Fehler beim Aktualisieren des Follow-Status');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isFollowing ? "outline" : "default"}
            onClick={handleFollowClick}
            disabled={isLoading}
            className="flex-1 sm:flex-none transition-all duration-200"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Laden...
              </>
            ) : isFollowing ? (
              <>
                <Users className="mr-2 h-4 w-4" />
                Folge ich
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Folgen
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isFollowing 
            ? `${userName} nicht mehr folgen` 
            : `${userName} folgen`}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}