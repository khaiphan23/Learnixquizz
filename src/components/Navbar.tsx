import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { useLang } from '../store/LangContext';
import { BookOpen, Home, Library, Settings, LogOut, Menu, X, PlusCircle, Globe, Moon, Sun } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));

  const toggleTheme = () => {
    const root = document.documentElement;
    if (darkMode) { root.classList.remove('dark'); root.classList.add('light'); } 
    else { root.classList.remove('light'); root.classList.add('dark'); }
    setDarkMode(!darkMode);
  };

  const isActive = (path: string) => location.pathname === path;
  const navLink = (path: string, label: string, icon: React.ReactNode) => (
    <button onClick={() => { navigate(path); setMenuOpen(false); }}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive(path) ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      {icon}{label}
    </button>
  );

  return (
    <nav className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 font-bold text-xl text-indigo-600 dark:text-indigo-400">
          <BookOpen className="h-6 w-6" />{t.appName}
        </button>

        <div className="hidden md:flex items-center gap-1">
          {navLink('/', t.home, <Home className="h-4 w-4" />)}
          {navLink('/library', t.library, <Library className="h-4 w-4" />)}
          {user && navLink('/my-quizzes', t.myQuizzes, <BookOpen className="h-4 w-4" />)}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title={t.language}>
            <Globe className="h-4 w-4" />
          </button>
          <button onClick={toggleTheme} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {user ? (
            <>
              <button onClick={() => navigate('/create')} className="hidden md:flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors">
                <PlusCircle className="h-4 w-4" />{t.createQuiz}
              </button>
              <button onClick={() => navigate('/settings')} className="hidden md:block p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                {user.photoURL ? <img src={user.photoURL} className="h-8 w-8 rounded-full object-cover" alt={user.name} /> : <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold">{user.name[0].toUpperCase()}</div>}
              </button>
              <button onClick={() => { logout(); navigate('/'); }} className="hidden md:flex items-center gap-1 p-2 text-slate-500 hover:text-red-500 transition-colors">
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (
            <div className="hidden md:flex items-center gap-2">
              <button onClick={() => navigate('/login')} className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">{t.login}</button>
              <button onClick={() => navigate('/register')} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors">{t.register}</button>
            </div>
          )}
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 space-y-1">
          {navLink('/', t.home, <Home className="h-4 w-4" />)}
          {navLink('/library', t.library, <Library className="h-4 w-4" />)}
          {user && navLink('/my-quizzes', t.myQuizzes, <BookOpen className="h-4 w-4" />)}
          {user && navLink('/create', t.createQuiz, <PlusCircle className="h-4 w-4" />)}
          {user && navLink('/settings', t.settings, <Settings className="h-4 w-4" />)}
          {user ? (
            <button onClick={() => { logout(); navigate('/'); setMenuOpen(false); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 w-full">
              <LogOut className="h-4 w-4" />{t.logout}
            </button>
          ) : (
            <>
              <button onClick={() => { navigate('/login'); setMenuOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">{t.login}</button>
              <button onClick={() => { navigate('/register'); setMenuOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">{t.register}</button>
            </>
          )}
        </div>
      )}
    </nav>
  );
};
