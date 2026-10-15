"use client";

import { AppHeader } from '@/components/app-shell';
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";

interface AdminHeaderProps {
    onMenuClick: () => void;
    title?: string;
}

export function AdminHeader({ onMenuClick, title = "Administration" }: AdminHeaderProps) {
    return (
        <AppHeader>
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3">
                <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-4">
                    <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-foreground tracking-tight sm:text-xl" title={title}>{title}</h2>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                        <ThemeToggle />
                        <UserNav />
                    </div>
                </div>
            </div>
        </AppHeader>
    );
}
