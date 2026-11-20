import type { UserProfile } from '../types';

export function toUserProfile(user: {
  id: string;
  email?: string;
  user_metadata?: Record<string, any>;
}): UserProfile {
  const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture;
  return {
    id: user.id,
    email: user.email,
    fullName:
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'Reader',
    avatarUrl: typeof avatar === 'string' && /^https?:\/\//i.test(avatar) ? avatar : undefined,
  };
}

