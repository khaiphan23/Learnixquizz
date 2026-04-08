import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', size = 'md', isLoading, children, className = '', disabled, ...props }) => {
  const base = 'inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500',
    outline: 'border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 focus:ring-indigo-500',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 focus:ring-slate-500',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
  };
  const sizes = { sm: 'px-3 py-1.5 text-sm gap-1.5', md: 'px-4 py-2.5 text-sm gap-2', lg: 'px-6 py-3 text-base gap-2' };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} disabled={disabled || isLoading} {...props}>
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
};

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}
export const Input: React.FC<InputProps> = ({ label, error, className = '', ...props }) => (
  <div className="space-y-1">
    {label && <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>}
    <input className={`w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-slate-400 dark:placeholder:text-slate-500 ${error ? 'border-red-400' : ''} ${className}`} {...props} />
    {error && <p className="text-sm text-red-500">{error}</p>}
  </div>
);

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}
export const Select: React.FC<SelectProps> = ({ label, options, className = '', ...props }) => (
  <div className="space-y-1">
    {label && <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>}
    <select className={`w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 ${className}`} {...props}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

export const Card: React.FC<{ children: React.ReactNode; className?: string; onClick?: () => void }> = ({ children, className = '', onClick }) => (
  <div className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm ${onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all' : ''} ${className}`} onClick={onClick}>
    {children}
  </div>
);

export const Badge: React.FC<{ children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = ({ children, variant = 'default' }) => {
  const variants = { default: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300', success: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300', warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300', danger: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300', info: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300' };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variants[variant]}`}>{children}</span>;
};

export const Spinner: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return <Loader2 className={`${sizes[size]} animate-spin text-indigo-600`} />;
};

export const Modal: React.FC<{ isOpen: boolean; onClose: () => void; title?: string; children: React.ReactNode }> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 z-10">
        {title && <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>}
        {children}
      </div>
    </div>
  );
};

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }> = ({ label, className = '', ...props }) => (
  <div className="space-y-1">
    {label && <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>}
    <textarea className={`w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-none ${className}`} {...props} />
  </div>
);
