'use client';

/**
 * Safe wrapper for framer-motion that handles SSR/Docker environments
 * This provides fallback components when framer-motion fails to load
 */

import React, { useEffect, useState, forwardRef, ComponentProps, ReactNode } from 'react';

// Type definitions
type MotionDivProps = ComponentProps<'div'> & {
    initial?: any;
    animate?: any;
    exit?: any;
    transition?: any;
    whileHover?: any;
    whileTap?: any;
    layout?: boolean | string;
};

type AnimatePresenceProps = {
    children: ReactNode;
    mode?: 'sync' | 'wait' | 'popLayout';
    initial?: boolean;
    onExitComplete?: () => void;
};

// Fallback div component that ignores motion props
const FallbackDiv = forwardRef<HTMLDivElement, MotionDivProps>(
    ({ initial, animate, exit, transition, whileHover, whileTap, layout, ...props }, ref) => {
        return <div ref={ref} {...props} />;
    }
);
FallbackDiv.displayName = 'FallbackDiv';

// Fallback AnimatePresence that just renders children
const FallbackAnimatePresence = ({ children }: AnimatePresenceProps) => {
    return <>{children}</>;
};

// Create a motion object with dynamic loading
export const motion = {
    div: FallbackDiv,
    span: forwardRef<HTMLSpanElement, MotionDivProps>(
        ({ initial, animate, exit, transition, whileHover, whileTap, layout, ...props }, ref) => {
            return <span ref={ref} {...props} />;
        }
    ),
    button: forwardRef<HTMLButtonElement, MotionDivProps & ComponentProps<'button'>>(
        ({ initial, animate, exit, transition, whileHover, whileTap, layout, ...props }, ref) => {
            return <button ref={ref} {...props} />;
        }
    ),
};

motion.span.displayName = 'FallbackSpan';
motion.button.displayName = 'FallbackButton';

// Export AnimatePresence as fallback
export const AnimatePresence = FallbackAnimatePresence;

// Dynamic loading hook - can be used to enable animations after hydration
export function useMotion() {
    const [motionLib, setMotionLib] = useState<typeof import('framer-motion') | null>(null);

    useEffect(() => {
        // Only load framer-motion on client side
        import('framer-motion')
            .then((mod) => {
                setMotionLib(mod);
            })
            .catch(() => {
                console.warn('framer-motion failed to load, using fallback components');
            });
    }, []);

    return motionLib;
}
