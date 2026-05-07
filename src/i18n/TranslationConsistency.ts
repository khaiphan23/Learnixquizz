/**
 * Translation Consistency
 * Manages multilingual data consistency and cache isolation
 */

import { queryClient } from '../lib/queryClient';
import { cacheSynchronizer } from '../cache/CacheSynchronizer';

interface LanguageState {
  uiLanguage: string;
  quizLanguages: Map<string, string>; // quizId -> language
  bilingualMode: boolean;
}

class TranslationConsistency {
  private languageState: LanguageState = {
    uiLanguage: 'vi',
    quizLanguages: new Map(),
    bilingualMode: false,
  };

  // Get effective language for quiz
  getEffectiveLanguage(
    quizId: string,
    availableLanguages: string[],
    originalLanguage: string
  ): string {
    const { uiLanguage, quizLanguages } = this.languageState;

    // Priority 1: User explicitly set language for this quiz
    const explicit = quizLanguages.get(quizId);
    if (explicit && availableLanguages.includes(explicit)) {
      return explicit;
    }

    // Priority 2: UI language is available
    if (availableLanguages.includes(uiLanguage)) {
      return uiLanguage;
    }

    // Priority 3: Original language
    if (availableLanguages.includes(originalLanguage)) {
      return originalLanguage;
    }

    // Priority 4: First available
    if (availableLanguages.length > 0) {
      return availableLanguages[0];
    }

    // Fallback
    return 'vi';
  }

  // Prefetch translation before switching
  async prefetchTranslation(
    quizId: string,
    language: string
  ): Promise<boolean> {
    const queryKey = ['quiz', quizId, language];
    
    // Check if already cached
    const existing = queryClient.getQueryData(queryKey);
    if (existing) return true;

    // Prefetch
    try {
      await queryClient.prefetchQuery({
        queryKey,
        queryFn: async () => {
          const { supabase } = await import('../services/supabase');
          
          const { data } = await supabase.rpc('get_quiz_with_translations', {
            p_quiz_id: quizId,
            p_language: language,
          });
          
          return data;
        },
        staleTime: 5 * 60 * 1000,
      });
      
      return true;
    } catch {
      return false;
    }
  }

  // Switch language atomically
  async switchLanguage(
    quizId: string,
    newLanguage: string,
    availableLanguages: string[]
  ): Promise<void> {
    // Validate language is available
    if (!availableLanguages.includes(newLanguage)) {
      console.warn(`[TranslationConsistency] Language ${newLanguage} not available`);
      return;
    }

    // Prefetch if needed
    await this.prefetchTranslation(quizId, newLanguage);

    // Update state
    this.languageState.quizLanguages.set(quizId, newLanguage);
  }

  // Update translation availability
  updateAvailability(quizId: string, languages: string[]): void {
    cacheSynchronizer.patch(
      ['quiz', quizId, 'meta'],
      (old: any) => ({
        ...old,
        supportedLanguages: languages,
      })
    );
  }

  // Enable bilingual mode (loads both languages)
  async enableBilingualMode(
    quizId: string,
    primaryLang: string,
    secondaryLang: string
  ): Promise<void> {
    // Prefetch both languages
    await Promise.all([
      this.prefetchTranslation(quizId, primaryLang),
      this.prefetchTranslation(quizId, secondaryLang),
    ]);

    this.languageState.bilingualMode = true;
  }

  // Get language state
  getState(): LanguageState {
    return {
      uiLanguage: this.languageState.uiLanguage,
      quizLanguages: new Map(this.languageState.quizLanguages),
      bilingualMode: this.languageState.bilingualMode,
    };
  }

  // Set UI language
  setUILanguage(lang: string): void {
    this.languageState.uiLanguage = lang;
  }
}

export const translationConsistency = new TranslationConsistency();

export function useTranslationConsistency() {
  return {
    getEffectiveLanguage: (quizId: string, available: string[], original: string) =>
      translationConsistency.getEffectiveLanguage(quizId, available, original),
    prefetchTranslation: (quizId: string, lang: string) =>
      translationConsistency.prefetchTranslation(quizId, lang),
    switchLanguage: (quizId: string, lang: string, available: string[]) =>
      translationConsistency.switchLanguage(quizId, lang, available),
    updateAvailability: (quizId: string, langs: string[]) =>
      translationConsistency.updateAvailability(quizId, langs),
    enableBilingualMode: (quizId: string, p: string, s: string) =>
      translationConsistency.enableBilingualMode(quizId, p, s),
    setUILanguage: (lang: string) => translationConsistency.setUILanguage(lang),
  };
}
