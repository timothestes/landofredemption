"use client";

import { getParagonByName, ParagonData } from "../data/paragons";
import { ParagonBrigadeStats } from "../utils/deckValidation";

interface ParagonRequirementsProps {
  paragonName: string;
  stats?: ParagonBrigadeStats;
}

export default function ParagonRequirements({ paragonName, stats }: ParagonRequirementsProps) {
  const paragon = getParagonByName(paragonName);
  
  if (!paragon) return null;

  const requirements = [
    {
      label: paragon.goodBrigade,
      required: paragon.primaryGood,
      current: stats?.primaryGood || 0,
      color: "blue",
      description: `${paragon.primaryGood} good-aligned cards with ${paragon.goodBrigade} brigade`,
    },
    {
      label: "Other Good",
      required: paragon.otherGood,
      current: stats?.otherGood || 0,
      color: "green",
      description: `${paragon.otherGood} good-aligned cards from any brigade except ${paragon.goodBrigade}`,
    },
    {
      label: "Neutral",
      required: paragon.neutral,
      current: stats?.neutral || 0,
      color: "gray",
      description: `${paragon.neutral} neutral-aligned cards`,
    },
    {
      label: paragon.evilBrigade,
      required: paragon.primaryEvil,
      current: stats?.primaryEvil || 0,
      color: "red",
      description: `${paragon.primaryEvil} evil-aligned cards with ${paragon.evilBrigade} brigade`,
    },
    {
      label: "Other Evil",
      required: paragon.otherEvil,
      current: stats?.otherEvil || 0,
      color: "orange",
      description: `${paragon.otherEvil} evil-aligned cards from any brigade except ${paragon.evilBrigade}`,
    },
    {
      label: "Doms",
      required: 7,
      current: stats?.dominants || 0,
      color: "purple",
      description: "Maximum 7 Dominants allowed in Paragon format",
      isMax: true,
    },
  ];

  return (
    <div className="md:mt-3 p-2 md:p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg">
      {/* Title - hidden on mobile (shown inline next to paragon image instead) */}
      <div className="hidden md:flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold text-purple-900 dark:text-purple-100">
          {paragon.name} Requirements
        </span>
      </div>

      <div className="grid grid-cols-6 gap-1.5 md:gap-2">
        {requirements.map((req, index) => {
          const isMet = req.isMax ? req.current <= req.required : req.current === req.required;
          const isOver = req.current > req.required;

          return (
            <div
              key={index}
              className="group relative"
              title={req.description}
            >
              <div
                className={`text-center px-1 py-1.5 md:p-2 rounded border transition-all ${
                  isMet
                    ? 'bg-green-100 dark:bg-green-900/30 border-green-500 dark:border-green-600'
                    : isOver
                    ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-500 dark:border-yellow-600'
                    : 'bg-red-100 dark:bg-red-900/30 border-red-500 dark:border-red-600'
                }`}
              >
                <div className="text-[10px] md:text-xs font-medium text-foreground truncate">
                  {req.label}
                </div>
                <div className={`text-sm md:text-lg font-bold ${
                  isMet
                    ? 'text-green-700 dark:text-green-300'
                    : isOver
                    ? 'text-yellow-700 dark:text-yellow-300'
                    : 'text-red-700 dark:text-red-300'
                }`}>
                  {req.current}/{req.required}
                </div>
              </div>

              {/* Tooltip on hover */}
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-foreground text-background text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 whitespace-nowrap">
                {req.description}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-foreground"></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Note - hidden on mobile (shown inline next to paragon image instead) */}
      <div className="hidden md:block mt-2 text-xs text-purple-700 dark:text-purple-300">
        <strong>Note:</strong> No Lost Souls. 40 Card Main deck. 10 Card Reserve. Maximum 7 Dominants.
      </div>
    </div>
  );
}
