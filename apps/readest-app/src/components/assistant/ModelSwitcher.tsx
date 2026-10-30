'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckIcon, CpuIcon, Loader2Icon } from 'lucide-react';
import { useAssistantState } from '@assistant-ui/react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GATEWAY_MODELS } from '@/services/ai/constants';
import { fetchOpenRouterModels } from '@/services/ai/providers/OpenRouterProvider';
import type { AISettings } from '@/services/ai/types';

const MODEL_FIELD: Record<AISettings['provider'], keyof AISettings> = {
  ollama: 'ollamaModel',
  'ai-gateway': 'aiGatewayModel',
  openrouter: 'openrouterModel',
};

export const ModelSwitcher = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const isRunning = useAssistantState((s) => s.thread.isRunning);

  const aiSettings = settings.aiSettings;
  const provider = aiSettings.provider;
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);

  const currentModel = useMemo(() => {
    if (!aiSettings) return '';
    if (provider === 'ollama') return aiSettings.ollamaModel;
    if (provider === 'openrouter') return aiSettings.openrouterModel || '';
    return aiSettings.aiGatewayModel || GATEWAY_MODELS.GEMINI_FLASH_LITE;
  }, [aiSettings, provider]);

  useEffect(() => {
    if (!aiSettings) return;
    if (provider === 'ai-gateway') {
      const list: string[] = [...Object.values(GATEWAY_MODELS)];
      if (aiSettings.aiGatewayCustomModel && !list.includes(aiSettings.aiGatewayCustomModel)) {
        list.push(aiSettings.aiGatewayCustomModel);
      }
      setModels(list);
      setFetching(false);
      return;
    }

    let cancelled = false;
    setFetching(true);
    const load = async () => {
      try {
        if (provider === 'ollama') {
          const response = await fetch(`${aiSettings.ollamaBaseUrl}/api/tags`);
          if (!response.ok) throw new Error('Failed to fetch models');
          const data = await response.json();
          if (!cancelled) setModels(data.models?.map((m: { name: string }) => m.name) ?? []);
        } else {
          const list = await fetchOpenRouterModels(
            aiSettings.openrouterBaseUrl ?? 'https://openrouter.ai/api/v1',
            aiSettings.openrouterApiKey ?? '',
          );
          if (!cancelled) setModels(list.map((m) => m.id).filter(Boolean));
        }
      } catch {
        if (!cancelled) setModels([]);
      } finally {
        if (!cancelled) setFetching(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the fetch inputs matter; selecting a model must not refetch
  }, [
    provider,
    aiSettings.ollamaBaseUrl,
    aiSettings.openrouterBaseUrl,
    aiSettings.openrouterApiKey,
  ]);

  const handleSelect = useCallback(
    (model: string) => {
      if (!settings || !aiSettings) return;
      const newAiSettings = { ...aiSettings, [MODEL_FIELD[provider]]: model };
      const newSettings = { ...settings, aiSettings: newAiSettings };
      setSettings(newSettings);
      void saveSettings(envConfig, newSettings);
    },
    [settings, aiSettings, provider, envConfig, setSettings, saveSettings],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          disabled={isRunning}
          title={_('Select AI model')}
          aria-label={_('Select AI model')}
          className='text-base-content hover:bg-base-300 mb-0.5 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40'
        >
          <CpuIcon className='size-3.5' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='bg-base-100 border-base-content/10 w-72 p-2'>
        <div className='text-base-content/60 mb-1 px-1 text-[11px] font-semibold'>
          {_('Select AI model')}
        </div>
        {currentModel && (
          <div className='text-base-content/60 mb-1 truncate px-1 text-[10px]'>{currentModel}</div>
        )}
        {fetching && (
          <div className='text-base-content/60 flex items-center gap-1 px-1 py-1 text-[11px]'>
            <Loader2Icon className='size-3 animate-spin' />
            {_('Loading...')}
          </div>
        )}
        {!fetching && models.length === 0 && (
          <div className='text-base-content/60 px-1 py-1 text-[11px]'>{_('No models found')}</div>
        )}
        {!fetching &&
          models.map((model) => (
            <DropdownMenuItem
              key={model}
              onSelect={() => handleSelect(model)}
              className='gap-1.5 text-[12px]'
            >
              <span className='min-w-0 flex-1 truncate'>{model}</span>
              {model === currentModel && <CheckIcon className='size-3 shrink-0' />}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
