"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { 
  User, 
  Settings, 
  LogOut, 
  Shield, 
  BookOpen, 
  MessageSquare 
} from "lucide-react"

export function UserNav() {
  const { data: session } = useSession()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut({ 
      callbackUrl: '/login',
      redirect: true 
    })
  }

  const getInitials = (name: string | null | undefined) => {
    if (!name) return "U"
    return name
      .split(" ")
      .map(word => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const navigateToProfile = () => {
    if (session?.user?.id) {
      router.push(`/profile/${session.user.id}`)
    }
  }

  const navigateToSettings = () => {
    router.push('/settings')
  }

  const navigateToAdmin = () => {
    router.push('/admin/users')
  }

  const navigateToCourses = () => {
    router.push('/courses')
  }

  const navigateToMessages = () => {
    router.push('/notifications')  
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          className="relative h-8 w-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage 
              src={session?.user?.image || ''} 
              alt={session?.user?.name || 'User'} 
              className="object-cover"
            />
            <AvatarFallback className="bg-slate-200 dark:bg-slate-700">
              {getInitials(session?.user?.name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {session?.user?.name}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {session?.user?.email}
            </p>
            {session?.user?.title && (
              <p className="text-xs text-muted-foreground">
                {session.user.title}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem 
            onClick={navigateToProfile}
            className="cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <User className="mr-2 h-4 w-4" />
            <span>Profil</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={navigateToSettings}
            className="cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Settings className="mr-2 h-4 w-4" />
            <span>Einstellungen</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={navigateToCourses}
            className="cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <BookOpen className="mr-2 h-4 w-4" />
            <span>Meine Kurse</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={navigateToMessages}
            className="cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            <span>Nachrichten</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {session?.user?.role === 'ADMIN' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem 
                onClick={navigateToAdmin}
                className="cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Shield className="mr-2 h-4 w-4" />
                <span>Admin Dashboard</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={handleSignOut}
          className="text-red-600 dark:text-red-400 cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/10"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Abmelden</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}