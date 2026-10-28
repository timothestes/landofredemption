import React, { useState } from 'react';
import Image from 'next/image';
import { useCardImageUrl } from '../hooks/useCardImageUrl';

interface CardImageProps {
  imgFile: string; // Changed from src to imgFile
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  onClick?: () => void;
}

export default function CardImage({ imgFile, alt, className = "", sizes, priority = false, onClick }: CardImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const { getImageUrl } = useCardImageUrl();
  
  const src = getImageUrl(imgFile);

  return (
    <div className="relative w-full aspect-[2.5/3.5] bg-transparent rounded overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse">
          <div className="text-muted-foreground text-xs">Loading...</div>
        </div>
      )}
      
      {hasError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-xs p-2 text-center">
          {alt}
        </div>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          className={`object-contain transition-opacity duration-200 ${isLoading ? 'opacity-0' : 'opacity-100'} ${className}`}
          sizes={sizes}
          priority={priority}
          // next/image throws in dev when both are set; priority already means eager.
          loading={priority ? undefined : "lazy"}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
          onClick={onClick}
          unoptimized={src.startsWith('/api/')}
        />
      )}
    </div>
  );
}
