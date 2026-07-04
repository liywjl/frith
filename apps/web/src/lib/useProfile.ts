import { useEffect, useState } from 'react';
import type { ProfilePageDto } from '@app/shared';
import { api } from './api';

/** Fetch a user's (viewer-scoped) profile page, refetching when the user changes. */
export function useProfile(userId: string): ProfilePageDto | null {
  const [profile, setProfile] = useState<ProfilePageDto | null>(null);
  useEffect(() => {
    setProfile(null);
    api.profile(userId).then(setProfile).catch(console.error);
  }, [userId]);
  return profile;
}
