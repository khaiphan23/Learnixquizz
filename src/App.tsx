import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './store/AuthContext';
import { QuizProvider } from './store/QuizContext';
import { LangProvider } from './store/LangContext';
import { Navbar } from './components/Navbar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Home } from './pages/Home';
import { Login, Register, ForgotPassword } from './pages/Auth';
import { MyQuizzes } from './pages/MyQuizzes';
import { CreateQuiz } from './pages/CreateQuiz';
import { TakeQuiz } from './pages/TakeQuiz';
import { QuizResult } from './pages/QuizResult';
import { Library, Settings } from './pages/LibrarySettings';
import { ResetPassword } from './pages/ResetPassword';
import { QuizStats } from './pages/QuizStats';
import { Leaderboard } from './pages/Leaderboard';
import { Spinner } from './components/ui';
import { supabase } from './services/supabase';

// Xử lý token recovery từ URL hash thủ công
// Vì detectSessionInUrl=false, Supabase không tự đọc token
// Ta cần parse hash và set session trước khi HashRouter khởi động
function handleRecoveryToken() {
  const hash = window.location.hash;
  // Supabase redirect dạng: /#access_token=xxx&type=recovery&...
  // hoặc: /#/reset-password  (nếu AuthContext đã redirect)
  if (!hash.includes('access_token')) return;

  const params = new URLSearchParams(hash.replace(/^#\/?/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const type = params.get('type');

  if (accessToken && type === 'recovery') {
    // Set session thủ công để Supabase nhận ra
    supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken ?? '',
    }).then(() => {
      // Xoá token khỏi URL rồi redirect sang /reset-password
      window.location.hash = '#/reset-password';
    });
  }
}

// Chạy ngay khi module load, trước khi React render
handleRecoveryToken();

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuth();
  if (isLoading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const AppLayout: React.FC = () => {
  const { isLoading } = useAuth();

  if (isLoading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-xl shadow-indigo-200 dark:shadow-indigo-900 animate-pulse">
        <span className="text-white text-2xl font-black">E</span>
      </div>
      <Spinner size="lg" />
      <p className="text-slate-400 dark:text-slate-500 text-sm font-medium">LearnixQuizz</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-200">
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/library" element={<Library />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/quiz/:id" element={<TakeQuiz />} />
          <Route path="/result/:id" element={<QuizResult />} />
          <Route path="/my-quizzes" element={<ProtectedRoute><MyQuizzes /></ProtectedRoute>} />
          <Route path="/create" element={<ProtectedRoute><CreateQuiz /></ProtectedRoute>} />
          <Route path="/edit/:id" element={<ProtectedRoute><CreateQuiz /></ProtectedRoute>} />
          <Route path="/quiz/:id/stats" element={<ProtectedRoute><QuizStats /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

const App: React.FC = () => (
  <ErrorBoundary>
    <LangProvider>
      <AuthProvider>
        <QuizProvider>
          <HashRouter>
            <AppLayout />
          </HashRouter>
        </QuizProvider>
      </AuthProvider>
    </LangProvider>
  </ErrorBoundary>
);

export default App;
