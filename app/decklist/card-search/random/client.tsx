"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../utils";
import { ALL_CARDS } from "../data/cardIndex";
import { useCardImageUrl } from "../hooks/useCardImageUrl";
import { useCardPrices } from "../hooks/useCardPrices";
import { openYTGSearchPage } from "../ytgUtils";

export default function RandomCardClient() {
  const router = useRouter();
  const { getImageUrl } = useCardImageUrl();
  const { getPrice, getProductUrl } = useCardPrices();
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Initial load: pick a card and preload its image, then fade in
  useEffect(() => {
    if (ALL_CARDS.length === 0) {
      setError("No cards found");
      setLoading(false);
      return;
    }

    const randomIndex = Math.floor(Math.random() * ALL_CARDS.length);
    const parsed = ALL_CARDS[randomIndex];
    setCard(parsed);
    setLoading(false);

    const imgUrl = getImageUrl(parsed.imgFile);
    const img = new Image();
    img.src = imgUrl;
    img.onload = () => {
      setImageLoaded(true);
      requestAnimationFrame(() => setIsRevealing(false));
    };
    img.onerror = () => {
      setImageError(true);
      requestAnimationFrame(() => setIsRevealing(false));
    };
    // Safety timeout
    setTimeout(() => setIsRevealing(false), 3000);
  }, []);

  const pickRandomCard = useCallback(() => {
    if (ALL_CARDS.length === 0) return;
    setIsRevealing(true);

    // Pick a new card and preload its image before swapping
    const randomIndex = Math.floor(Math.random() * ALL_CARDS.length);
    const parsed = ALL_CARDS[randomIndex];
    const imgUrl = getImageUrl(parsed.imgFile);

    const img = new Image();
    img.src = imgUrl;

    const swap = () => {
      setCard(parsed);
      setImageError(false);
      setImageLoaded(true);
      // Small delay so the fade-out completes before fade-in
      requestAnimationFrame(() => {
        setIsRevealing(false);
        setLoading(false);
      });
    };

    const swapWithError = () => {
      setCard(parsed);
      setImageLoaded(false);
      setImageError(true);
      requestAnimationFrame(() => {
        setIsRevealing(false);
        setLoading(false);
      });
    };

    img.onload = () => {
      // Wait for fade-out to finish (300ms transition), then swap
      setTimeout(swap, 200);
    };
    img.onerror = () => {
      setTimeout(swapWithError, 200);
    };

    // Safety timeout — swap after 3s even if image hasn't loaded
    setTimeout(() => {
      if (isRevealing) {
        img.onload = null;
        img.onerror = null;
        swap();
      }
    }, 3000);
  }, [getImageUrl, isRevealing]);

  if (error || (!loading && !card)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <p className="text-destructive mb-4 text-sm">{error || "No card found"}</p>
          <button
            onClick={() => pickRandomCard()}
            className="px-4 py-2.5 bg-primary text-white dark:text-primary-foreground rounded-lg font-medium text-sm active:translate-y-[1px] transition-transform"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-center w-full max-w-xs md:max-w-sm">
        {/* Card image + name — this fades in/out on reveal */}
        <div
          className={`w-full transition-all duration-300 ${
            isRevealing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
          }`}
          style={{ transitionTimingFunction: 'var(--ease-out-quart)' }}
        >
          <div className="w-full aspect-[5/7] relative rounded-lg overflow-hidden">
            {!imageLoaded && !imageError && (
              <div className="absolute inset-0 bg-muted animate-pulse rounded-lg" />
            )}
            {imageError && (
              <div className="absolute inset-0 bg-muted flex items-center justify-center rounded-lg">
                <span className="text-muted-foreground text-sm">No image available</span>
              </div>
            )}
            {card && (
              <img
                src={getImageUrl(card.imgFile)}
                alt={card.name}
                className={`absolute inset-0 w-full h-full object-contain rounded-lg shadow-2xl ${imageLoaded ? 'block' : 'hidden'}`}
                onLoad={() => setImageLoaded(true)}
                onError={() => { setImageError(true); setImageLoaded(false); }}
                draggable={false}
              />
            )}
          </div>

          {/* Card name + price */}
          <div className="mt-3 flex items-center justify-center gap-2 w-full h-7">
            <h1 className="text-base md:text-lg font-semibold text-foreground truncate">{card?.name}</h1>
            {card && (() => {
              const cardKey = `${card.name}|${card.set}|${card.imgFile}`;
              const priceInfo = getPrice(cardKey);
              const productUrl = getProductUrl(cardKey);
              return (
                <button
                  onClick={() => productUrl
                    ? window.open(productUrl, '_blank', 'noopener,noreferrer')
                    : openYTGSearchPage(card.name)
                  }
                  className="flex-shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-xs font-semibold border border-emerald-700/25 dark:border-emerald-600/20 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 active:translate-y-[1px] transition-all duration-100"
                >
                  <img src="/sponsors/ytg-dark.png" alt="YTG" className="h-3.5 w-3.5 object-contain hidden dark:block" />
                  <img src="/sponsors/ytg-light.png" alt="YTG" className="h-3.5 w-3.5 object-contain dark:hidden" />
                  {priceInfo ? (
                    <>
                      <span>${priceInfo.price.toFixed(2)}</span>
                      <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </>
                  ) : (
                    <span>Shop</span>
                  )}
                </button>
              );
            })()}
          </div>
        </div>

        {/* Actions — always visible, never fade */}
        <div className="flex gap-2 w-full mt-4">
          <button
            onClick={() => router.push("/decklist/card-search")}
            className="h-11 px-4 flex-shrink-0 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted active:bg-muted font-medium text-sm transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => pickRandomCard()}
            disabled={isRevealing}
            className="h-11 flex-1 rounded-lg bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:bg-primary/90 active:translate-y-[1px] transition-all duration-100 disabled:opacity-60"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
            </svg>
            {isRevealing ? 'Drawing...' : 'Random Card'}
          </button>
        </div>
      </div>
    </div>
  );
}
