import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function plural(count: number, one: string, many: string) { return `${count} ${count === 1 ? one : many}`; }
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
