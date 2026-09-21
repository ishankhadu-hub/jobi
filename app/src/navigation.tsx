import { createContext, useContext } from 'react';

export type Route = { screen: string; params?: any };
export type NavCtx = {
  route: Route;
  go: (screen: string, params?: any) => void;
  back: () => void;
  reset: (screen: string, params?: any) => void;
};

// Kept in its own module so screens and App don't form an import cycle.
export const NavContext = createContext<NavCtx>(null as any);
export const useNav = () => useContext(NavContext);
