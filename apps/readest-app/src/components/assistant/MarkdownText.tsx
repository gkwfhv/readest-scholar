'use client';

import '@assistant-ui/react-markdown/styles/dot.css';

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import { type FC, memo, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';

import { TooltipIconButton } from './TooltipIconButton';
import { cn } from '@/utils/tailwind';
import { repairMathDelimiters } from '@/utils/mathDelimiters';
import { openExternalLink } from '@/utils/open';
import { highlightCode } from '@/utils/highlight';

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      preprocess={repairMathDelimiters}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      className='aui-md'
      components={defaultComponents}
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className='bg-muted text-foreground mt-4 flex items-center justify-between gap-4 rounded-t-lg px-4 py-2 text-sm font-semibold'>
      <span className='lowercase [&>span]:text-xs'>{language}</span>
      <TooltipIconButton tooltip='Copy' onClick={onCopy}>
        {!isCopied && <CopyIcon className='size-3' />}
        {isCopied && <CheckIcon className='size-3' />}
      </TooltipIconButton>
    </div>
  );
};

const useCopyToClipboard = ({ copiedDuration = 3000 }: { copiedDuration?: number } = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h1
      className={cn('mb-4 scroll-m-20 text-2xl font-bold tracking-tight last:mb-0', className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h2
      className={cn(
        'mb-3 mt-6 scroll-m-20 text-xl font-semibold tracking-tight first:mt-0 last:mb-0',
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h3
      className={cn(
        'mb-2 mt-4 scroll-m-20 text-lg font-semibold tracking-tight first:mt-0 last:mb-0',
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p className={cn('mb-3 leading-7 first:mt-0 last:mb-0', className)} {...props} />
  ),
  a: ({ className, href, children, ...props }) => (
    // eslint-disable-next-line jsx-a11y/anchor-has-content
    <a
      {...props}
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      className={cn('text-primary font-medium underline underline-offset-4', className)}
      onClick={(event) => openExternalLink(event, href)}
    >
      {children}
    </a>
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote className={cn('border-l-2 pl-4 italic', className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn('my-3 ml-6 list-disc [&>li]:mt-1', className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn('my-3 ml-6 list-decimal [&>li]:mt-1', className)} {...props} />
  ),
  hr: ({ className, ...props }) => <hr className={cn('my-4 border-b', className)} {...props} />,
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        'overflow-x-auto rounded-b-lg rounded-t-none bg-zinc-900 p-4 text-sm text-zinc-100',
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, children, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    if (!isCodeBlock) {
      return (
        <code
          className={cn('bg-muted rounded-sm border px-1 py-0.5 font-mono text-sm', className)}
          {...props}
        >
          {children}
        </code>
      );
    }
    const language = /language-([\w+#.-]+)/.exec(className || '')?.[1];
    const html = typeof children === 'string' ? highlightCode(children, language) : null;
    if (html === null) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className={cn('hljs', className)}
        {...props}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  },
  CodeHeader,
});
