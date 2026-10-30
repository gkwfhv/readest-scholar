import { useCallback } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useAIChatStore } from '@/store/aiChatStore';
import { useAuth } from '@/context/AuthContext';
import { aiAccountScope } from '@/services/ai/accountScope';

// Hook to open the chat panel and optionally load a specific conversation

export function useOpenAIInNotebook() {
  const { user } = useAuth();
  const { setNotebookVisible } = useNotebookStore();
  const { setActiveConversation, createConversation } = useAIChatStore();

  const openAIInNotebook = useCallback(
    async (options?: {
      conversationId?: string;
      bookHash?: string;
      newConversationTitle?: string;
    }) => {
      setNotebookVisible(true);

      if (options?.conversationId) {
        // Load existing conversation
        await setActiveConversation(options.conversationId);
      } else if (options?.bookHash && options?.newConversationTitle) {
        // Create new conversation
        await createConversation(
          aiAccountScope(options.bookHash, user?.id),
          options.newConversationTitle,
        );
      }
    },
    [setNotebookVisible, setActiveConversation, createConversation, user?.id],
  );

  const closeAIInNotebook = useCallback(() => {
    setNotebookVisible(false);
  }, [setNotebookVisible]);

  return {
    openAIInNotebook,
    closeAIInNotebook,
  };
}

export default useOpenAIInNotebook;
