import { create } from 'zustand';
import { AIConversation, AIMessage } from '@/services/ai/types';
import { aiStore } from '@/services/ai/storage/aiStore';
import { assertBookAiScopeActive, bookAiGeneration } from '@/services/ai/bookAiWork';

interface AIChatState {
  activeConversationId: string | null;
  conversations: AIConversation[];
  messages: AIMessage[];
  isLoadingHistory: boolean;
  currentBookHash: string | null;

  loadConversations: (bookHash: string) => Promise<void>;
  setActiveConversation: (id: string | null) => Promise<void>;
  createConversation: (bookHash: string, title: string) => Promise<string>;
  addMessage: (message: Omit<AIMessage, 'id' | 'createdAt'> & { id?: string }) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  clearActiveConversation: () => void;
  invalidateBookScope: (bookHash: string) => void;
}

let scopeRequestId = 0;
let selectionRequestId = 0;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useAIChatStore = create<AIChatState>((set, get) => ({
  activeConversationId: null,
  conversations: [],
  messages: [],
  isLoadingHistory: false,
  currentBookHash: null,

  loadConversations: async (bookHash: string) => {
    if (get().currentBookHash === bookHash && !get().isLoadingHistory) return;
    const requestId = ++scopeRequestId;
    ++selectionRequestId;
    // Clear synchronously so a different account never sees the previous
    // account's conversation list or messages during the IndexedDB lookup.
    set({
      currentBookHash: bookHash,
      conversations: [],
      activeConversationId: null,
      messages: [],
      isLoadingHistory: true,
    });
    try {
      const conversations = await aiStore.getConversations(bookHash);
      if (get().currentBookHash !== bookHash || requestId !== scopeRequestId) return;
      set({ conversations, isLoadingHistory: false });
    } catch {
      if (get().currentBookHash === bookHash && requestId === scopeRequestId) {
        set({ conversations: [], isLoadingHistory: false });
      }
    }
  },

  setActiveConversation: async (id: string | null) => {
    if (id === null) {
      ++selectionRequestId;
      set({ activeConversationId: null, messages: [], isLoadingHistory: false });
      return;
    }
    const scope = get().currentBookHash;
    if (!scope || !get().conversations.some((conv) => conv.id === id && conv.bookHash === scope)) {
      throw new Error('Conversation is outside the current AI account/book scope');
    }
    const requestId = ++selectionRequestId;
    set({ activeConversationId: id, messages: [], isLoadingHistory: true });
    try {
      const messages = await aiStore.getMessages(id);
      if (
        get().currentBookHash !== scope ||
        get().activeConversationId !== id ||
        requestId !== selectionRequestId
      )
        return;
      set({ messages, isLoadingHistory: false });
    } catch {
      if (
        get().currentBookHash === scope &&
        get().activeConversationId === id &&
        requestId === selectionRequestId
      ) {
        set({ messages: [], isLoadingHistory: false });
      }
    }
  },

  createConversation: async (bookHash: string, title: string) => {
    const generation = bookAiGeneration(bookHash);
    const assertCurrent = () => assertBookAiScopeActive(bookHash, generation);
    if (get().currentBookHash !== bookHash) {
      await get().loadConversations(bookHash);
    }
    if (get().currentBookHash !== bookHash) {
      throw new Error('AI account/book scope changed while creating a conversation');
    }
    const id = generateId();
    const now = Date.now();
    const conversation: AIConversation = {
      id,
      bookHash,
      title: title.slice(0, 50) || 'New conversation',
      createdAt: now,
      updatedAt: now,
    };
    await aiStore.saveConversation(conversation, assertCurrent);
    const conversations = await aiStore.getConversations(bookHash);
    if (get().currentBookHash !== bookHash) {
      // A logout can complete while storage is pending. Do not display the
      // newly written conversation in the next account's UI.
      return id;
    }
    set({
      conversations,
      activeConversationId: id,
      messages: [],
    });
    return id;
  },

  addMessage: async (message: Omit<AIMessage, 'id' | 'createdAt'> & { id?: string }) => {
    const { activeConversationId, currentBookHash, conversations } = get();
    const generation = currentBookHash ? bookAiGeneration(currentBookHash) : '';
    const assertCurrent = () => {
      if (currentBookHash) assertBookAiScopeActive(currentBookHash, generation);
    };
    if (
      !currentBookHash ||
      !activeConversationId ||
      message.conversationId !== activeConversationId ||
      !conversations.some(
        (conv) => conv.id === activeConversationId && conv.bookHash === currentBookHash,
      )
    ) {
      throw new Error('Message is outside the current AI account/book scope');
    }
    const fullMessage: AIMessage = {
      ...message,
      id: message.id ?? generateId(),
      createdAt: Date.now(),
    };
    await aiStore.saveMessage(fullMessage, currentBookHash, assertCurrent);
    if (
      get().currentBookHash !== currentBookHash ||
      get().activeConversationId !== activeConversationId
    )
      return;

    const conv = get().conversations.find((item) => item.id === activeConversationId);
    if (conv) {
      const updated = { ...conv, updatedAt: Date.now() };
      await aiStore.saveConversation(updated, assertCurrent);
      if (
        get().currentBookHash !== currentBookHash ||
        get().activeConversationId !== activeConversationId
      )
        return;
      set((state) => ({
        conversations: state.conversations.map((item) => (item.id === updated.id ? updated : item)),
        messages: [...state.messages, fullMessage],
      }));
    }
  },

  deleteConversation: async (id: string) => {
    const { currentBookHash, activeConversationId, conversations } = get();
    if (
      !currentBookHash ||
      !conversations.some((conv) => conv.id === id && conv.bookHash === currentBookHash)
    ) {
      throw new Error('Conversation is outside the current AI account/book scope');
    }
    await aiStore.deleteConversation(id);
    const updated = await aiStore.getConversations(currentBookHash);
    if (get().currentBookHash !== currentBookHash) return;
    set({
      conversations: updated,
      ...(activeConversationId === id ? { activeConversationId: null, messages: [] } : {}),
    });
  },

  renameConversation: async (id: string, title: string) => {
    const { currentBookHash, conversations } = get();
    if (
      !currentBookHash ||
      !conversations.some((conv) => conv.id === id && conv.bookHash === currentBookHash)
    ) {
      throw new Error('Conversation is outside the current AI account/book scope');
    }
    await aiStore.updateConversationTitle(id, title);
    const updated = await aiStore.getConversations(currentBookHash);
    if (get().currentBookHash === currentBookHash) set({ conversations: updated });
  },

  clearActiveConversation: () => {
    ++selectionRequestId;
    set({ activeConversationId: null, messages: [], isLoadingHistory: false });
  },

  invalidateBookScope: (bookHash: string) => {
    if (get().currentBookHash !== bookHash) return;
    ++scopeRequestId;
    ++selectionRequestId;
    set({
      currentBookHash: null,
      conversations: [],
      activeConversationId: null,
      messages: [],
      isLoadingHistory: false,
    });
  },
}));
