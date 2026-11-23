import { useEffect, useState } from 'react';
import { useStore } from '../store';

function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useResolvedTheme(): 'dark' | 'light' {
  const theme = useStore((state) => state.globalSettings.theme);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(getSystemTheme);

  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return theme === 'system' ? systemTheme : theme;
}
