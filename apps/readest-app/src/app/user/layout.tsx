import { Metadata } from 'next';

const scholarRelease = process.env['NEXT_PUBLIC_SCHOLAR_RELEASE'] === 'true';

export const metadata: Metadata = scholarRelease
  ? {
      title: 'Account & Sign In',
      description: 'Manage your Readest Scholar account, sync, and cloud library storage.',
    }
  : {
      title: 'Account & Sign In',
      description:
        'Sign in to your Readest account or manage your subscription, cloud library storage, and account settings.',
    };

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
