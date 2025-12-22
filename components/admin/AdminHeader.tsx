"use client";

import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

interface AdminHeaderProps {
    onMenuClick: () => void;
    title?: string;
}

export function AdminHeader({ onMenuClick, title = "Admin Dashboard" }: AdminHeaderProps) {
    return (
        <header className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border z-10 sticky top-0">
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center">
                        <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={onMenuClick}>
                            <Menu className="h-5 w-5" />
                        </Button>
                        <h2 className="text-xl font-semibold text-foreground tracking-tight">{title}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <UserNav />
                    </div>
                </div>
            </div>
        </header>
    );
}
