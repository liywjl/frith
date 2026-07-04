import { createContext, useContext } from 'react';
import type { UserDto } from '@app/shared';

/**
 * Person-related actions available everywhere a person appears, so that
 * chatting is always one click and the profile is always one hover away —
 * without threading callbacks through every component.
 */
export interface UserActions {
  openDm: (userId: string) => void;
  openProfile: (userId: string) => void;
  /** Show everyone in the network who shares this interest tag. */
  openTag: (tag: string) => void;
  getUser: (userId: string) => UserDto | undefined;
  isOnline: (userId: string) => boolean;
}

export const UserActionsContext = createContext<UserActions | null>(null);

export function useUserActions(): UserActions {
  const value = useContext(UserActionsContext);
  if (!value) throw new Error('UserActionsContext is not provided');
  return value;
}
