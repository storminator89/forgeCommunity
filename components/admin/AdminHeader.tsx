"use client";

import { AppHeader } from '@/components/app-shell';
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

interface AdminHeaderProps {
    onMenuClick: () => void;
    title?: string;
}

export function AdminHeader({ onMenuClick, title = "Administration" }: AdminHeaderProps) {
    return (
        <AppHeader>
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center">

                        <h2 className="text-xl font-semibold text-foreground tracking-tight">{title}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <UserNav />
                    </div>
                </div>
            </div>
        </AppHeader>
    );
}
