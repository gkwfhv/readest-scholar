import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken, getStoragePlanData } from '@/utils/access';

interface StorageStats {
  totalFiles: number;
  totalSize: number;
  usage: number;
  quota: number;
  usagePercentage: number;
  versionCount?: number;
  versionBytes?: number;
  byBookHash: Array<{
    bookHash: string | null;
    fileCount: number;
    totalSize: number;
  }>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    const supabase = createSupabaseAdminClient();

    const { data: liveStats, error: liveStatsError } = await supabase.rpc('get_storage_usage_v1', {
      p_user_id: user.id,
    });
    if (liveStatsError && !['PGRST202', '42883'].includes(liveStatsError.code)) {
      console.error('Error querying storage usage:', liveStatsError);
      return res.status(500).json({ error: 'Failed to retrieve storage statistics' });
    }
    const live = liveStats?.[0];
    if (!liveStatsError && !live) {
      return res.status(500).json({ error: 'Empty storage usage result' });
    }

    // Older self-hosted databases have no Scholar usage RPC yet.
    let totalFiles = live?.file_count ?? 0;
    let totalSize = live?.file_bytes ?? 0;
    if (liveStatsError) {
      const PAGE_SIZE = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('files')
          .select('file_size')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) {
          console.error('Error querying total stats:', error);
          return res.status(500).json({ error: 'Failed to retrieve storage statistics' });
        }
        totalFiles += data?.length ?? 0;
        totalSize += data?.reduce((sum, file) => sum + (file.file_size || 0), 0) ?? 0;
        if (!data || data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
    }
    const { quota } = getStoragePlanData(token);
    const usage = live?.usage_bytes ?? totalSize;
    const usagePercentage = quota > 0 ? Math.round((usage / quota) * 100) : 0;
    const PAGE_SIZE = 1000;

    // Get stats grouped by book_hash
    const { data: bookHashStats, error: bookHashError } = await supabase.rpc(
      'get_storage_by_book_hash',
      { p_user_id: user.id },
    );

    // Fallback if RPC function doesn't exist - manual aggregation
    let byBookHash: Array<{ bookHash: string | null; fileCount: number; totalSize: number }> = [];

    if (bookHashError) {
      console.warn('RPC function not available, using fallback aggregation:', bookHashError);

      let allFiles: { book_hash: string | null; file_size: number }[] = [];
      let fallbackOffset = 0;
      let fallbackHasMore = true;

      while (fallbackHasMore) {
        const { data, error: filesError } = await supabase
          .from('files')
          .select('book_hash, file_size')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .range(fallbackOffset, fallbackOffset + PAGE_SIZE - 1);

        if (filesError) break;

        if (data && data.length > 0) {
          allFiles = allFiles.concat(data);
          fallbackOffset += PAGE_SIZE;
          fallbackHasMore = data.length === PAGE_SIZE;
        } else {
          fallbackHasMore = false;
        }
      }

      if (allFiles.length > 0) {
        const grouped = new Map<string | null, { count: number; size: number }>();

        allFiles.forEach((file) => {
          const key = file.book_hash;
          const current = grouped.get(key) || { count: 0, size: 0 };
          grouped.set(key, {
            count: current.count + 1,
            size: current.size + file.file_size,
          });
        });

        byBookHash = Array.from(grouped.entries())
          .map(([bookHash, stats]) => ({
            bookHash,
            fileCount: stats.count,
            totalSize: stats.size,
          }))
          .sort((a, b) => b.totalSize - a.totalSize);
      }
    } else if (bookHashStats) {
      byBookHash = bookHashStats;
    }

    const response: StorageStats = {
      totalFiles,
      totalSize,
      usage,
      quota,
      usagePercentage,
      versionCount: live?.version_count ?? 0,
      versionBytes: live?.version_bytes ?? 0,
      byBookHash,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
