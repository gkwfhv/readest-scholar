'use client';

import React from 'react';
import {
  getAppDisplayName,
  getPublicWebBaseUrl,
  isScholarReleaseBundle,
} from '@/services/environment';

interface PageFooterProps {
  tagline: string;
}

export const PageFooter: React.FC<PageFooterProps> = ({ tagline }) => {
  const scholarRelease = isScholarReleaseBundle();
  return (
    <p className='text-base-content/50 mt-6 text-center text-xs'>
      <a
        href={scholarRelease ? getPublicWebBaseUrl() : 'https://readest.com'}
        className='hover:text-base-content/80 font-medium transition-colors'
        target='_blank'
        rel='noopener'
      >
        {getAppDisplayName()}
      </a>
      <span className='mx-1.5'>·</span>
      <span>{tagline}</span>
    </p>
  );
};
