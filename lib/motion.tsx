'use client';

/**
 * Safe wrapper for framer-motion that handles SSR/Docker environments
 * This provides fallback components when framer-motion fails to load
 * or for environments where we want to disable animations globally
 */

import React, { ComponentProps, ReactNode, forwardRef } from 'react';

// Safe proxy to handle any motion.xyz component access
const motionProxy = new Proxy({} as any, {
    get: (target, prop) => {
        // Return a forwardRef component for any property access (div, span, li, etc.)
        const Component = forwardRef((props: any, ref) => {
            const {
                initial, animate, exit, transition, variants,
                whileHover, whileTap, whileDrag, whileFocus, whileInView,
                viewport, onAnimationStart, onAnimationComplete, onLayoutAnimationComplete,
                layout, layoutId, layoutDependency, layoutScroll,
                drag, dragControls, dragListener, dragConstraints, dragElastic, dragMomentum,
                ...rest
            } = props;

            // If prop is a valid HTML tag, render it
            if (typeof prop === 'string') {
                // Handle special cases or generic fallbacks
                if (prop === 'custom') return <div ref={ref} {...rest} />;

                return React.createElement(prop, { ref, ...rest });
            }

            // Fallback for non-string props (symbols etc)
            return <div ref={ref} {...rest} />;
        });

        Component.displayName = `MotionFallback.${String(prop)}`;
        return Component;
    }
});

export const motion: any = motionProxy;

// Fallback AnimatePresence that just renders children
export const AnimatePresence = ({ children }: { children: ReactNode }) => {
    return <>{children}</>;
};

// Mock other common exports that might be used
export const useAnimation = () => ({
    start: () => Promise.resolve(),
    stop: () => { },
    set: () => { },
});

export const useScroll = () => ({
    scrollY: { on: () => { }, get: () => 0 },
    scrollYProgress: { on: () => { }, get: () => 0 },
});

export const useTransform = () => 0;

export const Reorder = {
    Group: ({ children, ...props }: any) => <ul {...props}>{children}</ul>,
    Item: ({ children, ...props }: any) => <li {...props}>{children}</li>,
};

// Export dummy versions of other hooks/components if needed
export default motion;
