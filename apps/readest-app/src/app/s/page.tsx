import type { Metadata } from 'next';
import { Suspense } from 'react';
import {
  getAppDisplayName,
  getPublicWebBaseUrl,
  getShareBaseUrl,
  isScholarReleaseBundle,
} from '@/services/environment';
import { resolveActiveShare } from '@/libs/shareServer';
import ShareLanding from './ShareLanding';

// Server-rendered metadata for chat unfurls. Lives on the page (not the
// layout) because Next only passes `searchParams` to page-level
// `generateMetadata` — layout metadata is shared across child pages and
// can't see the query string.
//
// In the Tauri build (output: 'export'), this whole route is dropped because
// rewrites and dynamic metadata require a server. Tauri intercepts the
// readest://share/{token} deep link before /s ever loads.

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Scholar is selected at server runtime for the generic Docker image, while
// the root layout title template is baked at build time. An absolute title
// prevents that upstream template from appending "| Readest" to Scholar links.
const sharePageTitle = (value: string): Metadata['title'] =>
  isScholarReleaseBundle() ? { absolute: value } : value;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const appName = getAppDisplayName();
  // The Tauri build runs `output: 'export'`, which forbids `await searchParams`
  // anywhere in collected page data. `process.env.NEXT_PUBLIC_APP_PLATFORM` is
  // replaced at build time, so this early return DCEs the rest of the function
  // out of the Tauri bundle and the route becomes fully static. The web build
  // keeps the full dynamic implementation below.
  if (process.env['NEXT_PUBLIC_APP_PLATFORM'] !== 'web') {
    return {
      title: sharePageTitle(`Open in ${appName}`),
      description: 'Open-source ebook reader for everyone, on every device.',
    };
  }

  const params = (await searchParams) ?? {};
  const tokenParam = params['token'];
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;

  if (!token) {
    return {
      title: sharePageTitle(`Open in ${appName}`),
      description: 'Open-source ebook reader for everyone, on every device.',
    };
  }

  const result = await resolveActiveShare(token);
  if (!result.ok) {
    return {
      title: sharePageTitle(`Share link unavailable · ${appName}`),
      description: 'This share link is no longer available.',
    };
  }
  const { share } = result;
  const shareUrl = `${getShareBaseUrl()}/${token}`;
  const ogImage = `${getPublicWebBaseUrl()}/api/share/${token}/og.png`;

  return {
    title: sharePageTitle(`${share.bookTitle} · Shared via ${appName}`),
    description: share.bookAuthor
      ? `${share.bookAuthor} · Shared via ${appName}`
      : `Shared via ${appName}`,
    openGraph: {
      type: 'book',
      url: shareUrl,
      title: share.bookTitle,
      description: share.bookAuthor
        ? `${share.bookAuthor} · Shared via ${appName}`
        : `Shared via ${appName}`,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: share.bookTitle,
      description: share.bookAuthor
        ? `${share.bookAuthor} · Shared via ${appName}`
        : `Shared via ${appName}`,
      images: [ogImage],
    },
  };
}

export default function Page() {
  // Client child uses useSearchParams, which Next 16 requires to be wrapped
  // in Suspense. Mirrors src/app/o/page.tsx.
  return (
    <Suspense fallback={null}>
      <ShareLanding />
    </Suspense>
  );
}
