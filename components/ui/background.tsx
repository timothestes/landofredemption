"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import Image from "next/image";

// The splash plate used to sit, blurred and at low opacity, behind every
// content page. That read as wallpaper, and it was inconsistent (home and
// articles painted over it). It now appears only where a full-bleed backdrop
// is the design: the Forge and the sign-in pages (the asset is literally
// "lor-login-splash"), plus the Jayden theme, whose whole look is the tinted
// plate. Everywhere else the page is the plain `bg-background` surface.
const SPLASH_PREFIXES = ["/forge", "/sign-in", "/sign-up", "/forgot-password"];

const Background: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Only run on client to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Use a safe default for server-side rendering and initial load
  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'light';
  const isLightTheme = currentTheme === 'light';
  const isJaydenTheme = currentTheme === 'jayden';

  const showSplash = isJaydenTheme || SPLASH_PREFIXES.some(prefix => pathname.startsWith(prefix));

  // Most pages render the app nav in the top 56px, so the hero starts at
  // top-14 to sit below it. The public /join pages have no nav, so that
  // offset leaves an empty dark band at the top — let the hero go full-bleed
  // there instead.
  const heroTop = pathname.startsWith("/join") ? "top-0" : "top-14";

  if (!showSplash) {
    return (
      <div className="min-h-screen w-full bg-background">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full relative">
      {/* Different background styling based on theme */}
      <div className="fixed inset-0 overflow-hidden">
        {/* Base background color */}
        <div className={`absolute inset-0 bg-background`}></div>

      {/* Hero image container */}
      <div className={`fixed inset-x-0 ${heroTop} bottom-0 overflow-hidden`}>
        {/* Base background color */}
        <div className="absolute inset-0 bg-background" />

        {/* Theme-dependent image + overlays. next-themes only resolves the theme
            on the client, so we hold these hidden until mounted — otherwise a
            dark-mode user gets a one-frame flash of the light-mode treatment on
            first paint (most visible on the Forge's large background area). The
            dark bg-background above paints immediately; this fades in over it. */}
        <div className={`absolute inset-0 transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          {/* Hero image */}
          <Image
            src="/lor-login-splash.webp"
            alt=""
            fill
            sizes="100vw"
            className={`object-cover object-top ${isLightTheme ? 'opacity-10' : isJaydenTheme ? 'opacity-40' : 'opacity-75'}`}
            style={{
              filter: isLightTheme
                ? 'brightness(1.8) contrast(0.7) saturate(0.3) blur(1.5px)'
                : isJaydenTheme
                ? 'brightness(0.7) contrast(1.15) saturate(2.2) hue-rotate(280deg)'
                : 'brightness(1.05) contrast(0.95)'
            }}
            priority
          />

          {/* Overlay for readability */}
          <div
            className={`absolute inset-0 ${isLightTheme ? 'bg-white/50 mix-blend-overlay' : !isJaydenTheme ? 'bg-black/40' : ''}`}
            style={isJaydenTheme ? { background: 'linear-gradient(135deg, hsla(0, 90%, 30%, 0.7) 0%, hsla(330, 85%, 35%, 0.55) 35%, hsla(270, 70%, 30%, 0.45) 60%, hsla(230, 85%, 35%, 0.7) 100%)' } : undefined}
          ></div>

          {/* Top vignette (darkens the bright top edge in Jayden mode) */}
          {isJaydenTheme && (
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, hsl(270, 20%, 4%) 0%, hsla(270, 20%, 4%, 0.7) 15%, transparent 45%)' }}></div>
          )}

          {/* Bottom vignette */}
          <div className={`absolute inset-0 bg-gradient-to-t ${isJaydenTheme ? 'from-[hsl(230,40%,5%)]/60' : 'from-gray-300/10 dark:from-black/40'} via-transparent to-transparent`}></div>

          {/* Bottom gradient */}
          <div className={`absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t ${isJaydenTheme ? 'from-[hsl(230,40%,5%)]/50' : 'from-gray-200/10 dark:from-black/30'} via-transparent to-transparent`}></div>

          {/* Depth gradient */}
          <div style={{
              position: 'absolute',
              top: '0px',
              right: '0px',
              bottom: '0px',
              left: '0px',
              backgroundImage: isLightTheme
                ? 'linear-gradient(to top, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0.03) 35%, transparent 65%)'
                : isJaydenTheme
                ? 'linear-gradient(135deg, rgba(120, 0, 0, 0.35) 0%, rgba(140, 0, 80, 0.15) 40%, rgba(60, 0, 120, 0.15) 60%, rgba(0, 20, 120, 0.35) 100%)'
                : 'linear-gradient(to top, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.15) 40%, transparent 80%)',
              pointerEvents: 'none',
            }}></div>
        </div>
      </div>
      </div>

      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default Background;
