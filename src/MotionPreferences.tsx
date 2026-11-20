import React, { createContext, useContext, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { watchSystemMotion } from './lib/systemMotion';

const ReducedMotion = createContext(true);

export function MotionPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => watchSystemMotion(AccessibilityInfo, setReduced), []);
  return <ReducedMotion.Provider value={reduced}>{children}</ReducedMotion.Provider>;
}

export function useReducedMotion(): boolean { return useContext(ReducedMotion); }
