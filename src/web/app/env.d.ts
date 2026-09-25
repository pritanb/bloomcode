/// <reference types="vite/client" />

interface Window {
  tutorDesktop?: {
    platform: string;
    getNavigation(): Promise<{ back: boolean; forward: boolean }>;
    navigate(direction: 'back' | 'forward'): void;
    onNavigation(callback: (state: { back: boolean; forward: boolean }) => void): () => void;
  };
}
