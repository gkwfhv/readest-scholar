import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getRuntimeConfig,
  loadSelfHostedRuntimeConfig,
  saveSelfHostedRuntimeConfig,
} from '@/services/runtimeConfig';
import Dialog from '@/components/Dialog';

export default function SelfHostedServerConfig() {
  const _ = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const config = getRuntimeConfig();
    if (config?.selfHosted && config.apiBaseUrl) setServerUrl(config.apiBaseUrl);
  }, [isOpen]);

  const saveServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const config = await loadSelfHostedRuntimeConfig(serverUrl);
      saveSelfHostedRuntimeConfig(config);
      window.location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : _('The server configuration could not be saved.'),
      );
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        type='button'
        className='text-base-content/70 hover:text-base-content text-sm underline underline-offset-2 transition-colors'
        onClick={() => setIsOpen(true)}
      >
        {_('Connect a self-hosted server')}
      </button>
      <Dialog
        isOpen={isOpen}
        title={_('Self-hosted server')}
        aboveKeyboard
        onClose={() => {
          if (!isSaving) setIsOpen(false);
        }}
      >
        {isOpen && (
          <form className='space-y-5 p-1' onSubmit={saveServer}>
            <div className='space-y-2'>
              <label className='text-sm font-medium' htmlFor='self-hosted-server-url'>
                {_('Server URL')}
              </label>
              <input
                id='self-hosted-server-url'
                type='url'
                required
                autoCapitalize='none'
                autoCorrect='off'
                inputMode='url'
                placeholder='https://scholar.example.com'
                className='input eink-bordered w-full rounded-lg'
                value={serverUrl}
                disabled={isSaving}
                onChange={(event) => setServerUrl(event.target.value)}
              />
              <p className='text-base-content/70 text-sm leading-relaxed'>
                {_('Enter the URL you use to open your Readest Scholar web page.')}
              </p>
            </div>
            {error && (
              <p
                role='alert'
                className='eink-bordered border-error/30 bg-error/5 text-error rounded-lg border px-3 py-2.5 text-sm'
              >
                {error}
              </p>
            )}
            <div className='flex justify-end gap-2'>
              <button
                type='button'
                className='btn btn-ghost eink-bordered rounded-lg'
                disabled={isSaving}
                onClick={() => setIsOpen(false)}
              >
                {_('Cancel')}
              </button>
              <button type='submit' className='btn btn-primary rounded-lg' disabled={isSaving}>
                {isSaving && (
                  <span className='loading loading-spinner loading-sm' aria-hidden='true' />
                )}
                {isSaving ? _('Connecting...') : _('Save and restart')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
