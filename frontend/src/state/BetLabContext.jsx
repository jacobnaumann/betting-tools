import { createContext, useContext, useEffect, useMemo } from 'react';
import { useLocalStorage } from '../utils/useLocalStorage';

const BetLabContext = createContext(null);

export function BetLabProvider({ children }) {
  const [favorites, setFavorites] = useLocalStorage('betlab.favorites', [
    'odds-converter',
    'bet-size',
  ]);
  const [history, setHistory] = useLocalStorage('betlab.history', []);
  const [notes, setNotes] = useLocalStorage('betlab.notes', []);
  const [theme, setTheme] = useLocalStorage('betlab.theme', 'dark');

  const toggleFavorite = (toolId) => {
    setFavorites((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    );
  };

  const addHistoryItem = (item) => {
    setHistory((prev) => [item, ...prev].slice(0, 25));
  };

  const addNote = (note) => {
    setNotes((prev) => [note, ...prev]);
  };

  const deleteNote = (noteId) => {
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
  };

  const clearHistory = () => setHistory([]);
  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      favorites,
      history,
      notes,
      theme,
      toggleFavorite,
      addHistoryItem,
      addNote,
      deleteNote,
      clearHistory,
      toggleTheme,
    }),
    [favorites, history, notes, theme]
  );

  return <BetLabContext.Provider value={value}>{children}</BetLabContext.Provider>;
}

export function useBetLab() {
  const context = useContext(BetLabContext);
  if (!context) {
    throw new Error('useBetLab must be used inside BetLabProvider');
  }
  return context;
}
