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
            <div className="app-header-row">
                <h2 className="app-header-title text-base font-semibold text-foreground tracking-tight sm:text-xl" title={title}>{title}</h2>
                <div className="app-header-actions">
                    <ThemeToggle />
                    <UserNav />
                </div>
            </div>
        </AppHeader>
    );
}
