import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combina classes Tailwind de manera segura, deduplicando conflictos.
 *
 *   cn("px-2 py-1", isActive && "bg-blue-500", "px-4")
 *   // => "py-1 bg-blue-500 px-4"
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
