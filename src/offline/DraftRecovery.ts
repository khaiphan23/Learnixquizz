/**
 * Draft Recovery System
 * Manages autosave drafts and recovery after refresh/crash
 */

interface DraftMetadata {
  entityId: string;
  entityType: 'quiz' | 'question';
  savedAt: number;
  serverVersionAtSave?: number;
  expiresAt: number;
}

interface Draft<T> extends DraftMetadata {
  data: T;
}

const DRAFT_STORAGE_KEY = 'learnix-drafts-v1';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class DraftRecovery {
  private drafts: Map<string, Draft<any>> = new Map();

  constructor() {
    this.hydrateFromStorage();
    this.cleanupExpired();
  }

  // Save draft
  save<T>(draft: Omit<Draft<T>, 'savedAt' | 'expiresAt'>): void {
    const fullDraft: Draft<T> = {
      ...draft,
      savedAt: Date.now(),
      expiresAt: Date.now() + DRAFT_TTL_MS,
    };

    this.drafts.set(draft.entityId, fullDraft);
    this.persist();

    console.log(`[DraftRecovery] Saved draft for ${draft.entityType}:${draft.entityId}`);
  }

  // Recover draft
  recover<T>(entityId: string): Draft<T> | null {
    const draft = this.drafts.get(entityId);
    
    if (!draft) return null;
    
    if (Date.now() > draft.expiresAt) {
      this.drafts.delete(entityId);
      this.persist();
      return null;
    }

    console.log(`[DraftRecovery] Recovered draft for ${draft.entityType}:${entityId}`);
    return draft as Draft<T>;
  }

  // Check if recovery needed (used on component mount)
  checkForRecovery(): Array<{ entityId: string; entityType: string; age: number }> {
    const recoverable: Array<{ entityId: string; entityType: string; age: number }> = [];

    this.drafts.forEach((draft, entityId) => {
      if (Date.now() > draft.expiresAt) {
        this.drafts.delete(entityId);
      } else {
        recoverable.push({
          entityId,
          entityType: draft.entityType,
          age: Date.now() - draft.savedAt,
        });
      }
    });

    if (this.drafts.size !== recoverable.length) {
      this.persist();
    }

    return recoverable;
  }

  // Delete draft after successful save
  deleteDraft(entityId: string): boolean {
    const existed = this.drafts.has(entityId);
    this.drafts.delete(entityId);
    
    if (existed) {
      this.persist();
    }
    
    return existed;
  }

  // Check if newer server version exists (conflict detection)
  async hasServerNewerVersion(
    entityId: string,
    entityType: string,
    savedVersion?: number
  ): Promise<boolean> {
    if (!savedVersion) return false;

    try {
      const { supabase } = await import('../services/supabase');
      
      let result;
      if (entityType === 'quiz') {
        result = await supabase
          .from('quizzes')
          .select('version, updated_at')
          .eq('id', entityId)
          .single();
      } else {
        return false;
      }

      if (result.data?.version && result.data.version > savedVersion) {
        return true;
      }

      return false;
    } catch {
      return false; // Assume no conflict on error
    }
  }

  // Cleanup expired drafts
  private cleanupExpired(): void {
    const now = Date.now();
    let changed = false;

    this.drafts.forEach((draft, id) => {
      if (now > draft.expiresAt) {
        this.drafts.delete(id);
        changed = true;
      }
    });

    if (changed) {
      this.persist();
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return;

    try {
      const data = Array.from(this.drafts.entries());
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('[DraftRecovery] Persistence failed:', e);
    }
  }

  private hydrateFromStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.drafts = new Map(parsed);
      }
    } catch (e) {
      console.error('[DraftRecovery] Hydration failed:', e);
    }
  }
}

export const draftRecovery = new DraftRecovery();

export function useDraftRecovery() {
  return {
    save: <T>(draft: Omit<Draft<T>, 'savedAt' | 'expiresAt'>) =>
      draftRecovery.save(draft),
    recover: <T>(entityId: string) => draftRecovery.recover<T>(entityId),
    checkForRecovery: () => draftRecovery.checkForRecovery(),
    deleteDraft: (entityId: string) => draftRecovery.deleteDraft(entityId),
    hasServerNewerVersion: (entityId: string, type: string, version?: number) =>
      draftRecovery.hasServerNewerVersion(entityId, type, version),
  };
}
