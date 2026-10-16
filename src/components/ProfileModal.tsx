import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { getAuthRedirectUrl, SUPABASE_URL } from '../lib/supabase';
import { colors, F, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { ReadingGoal, UserProfile } from '../types';
import { LibraryRestoreProgress, LibraryRestoreResult } from '../lib/catalog';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';
import { ProgressBar } from './ui/ProgressBar';

interface ProfileModalProps {
  goal: ReadingGoal;
  user: UserProfile | null;
  onClose: () => void;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onBackupLibrary: () => Promise<number>;
  onRestoreLibrary: (onProgress: (progress: LibraryRestoreProgress) => void) => Promise<LibraryRestoreResult | null>;
  showToast: (msg: string) => void;
}

const GoogleG: React.FC = () => (
  <Svg width={16} height={16} viewBox="0 0 24 24">
    <Path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
    />
    <Path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z"
    />
    <Path
      fill="#FBBC05"
      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
    />
    <Path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
    />
  </Svg>
);

export const ProfileModal: React.FC<ProfileModalProps> = ({
  goal,
  user,
  onClose,
  onGoogleSignIn,
  onSignOut,
  onBackupLibrary,
  onRestoreLibrary,
  showToast,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [libraryAction, setLibraryAction] = useState<'backup' | 'restore' | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<LibraryRestoreProgress | null>(null);
  const [restoreResult, setRestoreResult] = useState<LibraryRestoreResult | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  const projectHost = SUPABASE_URL.replace(/^https?:\/\//, '');
  const projectRef = projectHost.split('.')[0];

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await onGoogleSignIn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || 'Google sign in failed');
      setShowSetupGuide(true);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await onSignOut();
      showToast('Signed out of Folio');
    } catch {
      showToast('Sign out failed');
    }
  };

  const handleBackupLibrary = async () => {
    setLibraryAction('backup');
    setRestoreProgress(null);
    try {
      const count = await onBackupLibrary();
      showToast(`Backed up ${count} ${count === 1 ? 'book' : 'books'} to your account`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Library backup failed');
    } finally {
      setLibraryAction(null);
    }
  };

  const handleRestoreLibrary = async () => {
    setLibraryAction('restore');
    setRestoreResult(null);
    setRestoreProgress({ current: 0, total: 0, percent: 0, title: 'Loading your backup…', phase: 'loading' });
    try {
      const result = await onRestoreLibrary(setRestoreProgress);
      if (!result) {
        setRestoreProgress(null);
        showToast('No library backup found for this account');
      } else {
        setRestoreResult(result);
        showToast(
          `Restored ${result.restored}; skipped ${result.skipped} unavailable; ${result.lookupFailed} catalog lookup(s) timed out; ${result.alreadyInLibrary} already in library`
        );
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Library restore failed');
    } finally {
      setLibraryAction(null);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={384} cardStyle={{ maxHeight: '90%' }}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="account_circle" size={22} color={colors.primary} />
          <Text style={styles.headerTitle}>READER PROFILE &amp; ACCOUNT</Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <ScrollView>
        <View style={styles.userCard}>
          <View style={{ marginBottom: 12 }}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.guestAvatar}>
                <Icon name="account_circle" size={64} color={colors.muted} />
              </View>
            )}
            <View style={[styles.statusDot, { backgroundColor: user ? colors.emerald : colors.primary }]}>
              <Text style={styles.statusText}>{user ? '✓' : '•'}</Text>
            </View>
          </View>

          <Text style={styles.name}>{user?.fullName || 'Guest'}</Text>
          <Text style={styles.email}>{user?.email || 'Not signed in'}</Text>

          {user ? (
            <View style={styles.authRow}>
              <View style={styles.authBadge}>
                <View style={styles.authDot} />
                <Text style={styles.authBadgeText}>Authenticated via Google</Text>
              </View>
              <Pressable onPress={handleSignOut} hitSlop={8} disabled={!!libraryAction}>
                <Text style={styles.signOut}>Sign Out</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ width: '100%', marginTop: 12, gap: 8 }}>
              <Pressable onPress={handleSignIn} disabled={isSigningIn} style={[styles.googleBtn, isSigningIn && { opacity: 0.6 }]}>
                <GoogleG />
                <Text style={styles.googleText}>
                  {isSigningIn ? 'Connecting to Google...' : 'Sign in with Google / Gmail'}
                </Text>
              </Pressable>
              <Pressable onPress={() => setShowSetupGuide(!showSetupGuide)} style={styles.helpRow}>
                <Icon name="help" size={14} color={colors.primary} />
                <Text style={styles.helpText}>
                  {showSetupGuide ? 'Hide Supabase setup guide' : 'What do I need to set up in Supabase?'}
                </Text>
              </Pressable>
            </View>
          )}
          {user ? (
            <View style={[styles.libraryBackup, { backgroundColor: colors.surfaceLow, borderColor: colors.borderSoft }]}>
              <View style={styles.backupHeading}>
                <Icon name="cloud_upload" size={19} color={colors.primary} />
                <Text style={[styles.backupTitle, { color: colors.onSurface }]}>Library backup</Text>
              </View>
              <Text style={[styles.backupDescription, { color: colors.muted }]}>
                Save your book list to this account. Restore downloads available Project Gutenberg books again;
                EPUB files stay on your device.
              </Text>
              {libraryAction === 'restore' || restoreProgress?.phase === 'complete' ? (
                <View style={styles.restoreProgress}>
                  <View style={styles.restoreProgressLabels}>
                    <Text style={[styles.restoreProgressText, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
                      {restoreProgress?.phase === 'loading'
                        ? 'Loading your backup…'
                        : restoreProgress?.phase === 'complete'
                          ? restoreProgress.title
                          : `${restoreProgress?.phase === 'finding' ? 'Finding' : restoreProgress?.phase === 'downloading' ? 'Downloading' : 'Preparing'} ${restoreProgress?.title ?? ''}`}
                    </Text>
                    {restoreProgress && restoreProgress.total > 0 ? (
                      <Text style={[styles.restoreProgressText, { color: colors.muted }]}>
                        {restoreProgress.current}/{restoreProgress.total}
                      </Text>
                    ) : null}
                  </View>
                  <ProgressBar percent={restoreProgress?.percent ?? 0} height={4} />
                </View>
              ) : null}
              {restoreResult ? (
                <View style={[styles.restoreResult, { borderTopColor: colors.borderSoft }]}>
                  <Text style={[styles.restoreResultTitle, { color: colors.onSurface }]}>
                    {restoreResult.failures.length === 0
                      ? 'All available books were restored'
                      : `Could not restore ${restoreResult.failures.length} ${restoreResult.failures.length === 1 ? 'book' : 'books'}`}
                  </Text>
                  {restoreResult.failures.map((failure, index) => (
                    <View key={`${failure.title}-${index}`} style={styles.restoreFailure}>
                      <Icon name="cloud_off" size={15} color={colors.muted} />
                      <View style={styles.restoreFailureText}>
                        <Text style={[styles.restoreFailureTitle, { color: colors.onSurfaceVariant }]}>
                          {failure.title}
                        </Text>
                        <Text style={[styles.restoreProgressText, { color: colors.muted }]}>
                          {failure.reason}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.backupActions}>
                <Pressable
                  onPress={handleBackupLibrary}
                  disabled={!!libraryAction}
                  style={[
                    styles.backupButton,
                    { backgroundColor: colors.primaryContainer },
                    libraryAction && { opacity: 0.6 },
                  ]}
                >
                  <Icon name={libraryAction === 'backup' ? 'sync' : 'cloud_upload'} size={17} color={colors.white} spin={libraryAction === 'backup'} />
                  <Text style={[styles.backupButtonText, { color: colors.white }]}>
                    {libraryAction === 'backup' ? 'Backing up…' : 'Back up'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleRestoreLibrary}
                  disabled={!!libraryAction}
                  style={[
                    styles.backupButton,
                    { borderColor: colors.primary },
                    libraryAction && { opacity: 0.6 },
                  ]}
                >
                  <Icon name={libraryAction === 'restore' ? 'sync' : 'download'} size={17} color={colors.primary} spin={libraryAction === 'restore'} />
                  <Text style={[styles.backupButtonText, { color: colors.primary }]}>
                    {libraryAction === 'restore' ? 'Restoring…' : 'Restore'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {showSetupGuide && (
          <View style={styles.guide}>
            <View style={styles.guideHead}>
              <Icon name="tune" size={16} color={colors.primary} />
              <Text style={styles.guideTitle}>Supabase Google Auth Setup Checklist</Text>
            </View>
            <Text style={styles.guideIntro}>
              To enable Google / Gmail login with your Supabase project ({projectRef || 'your project'}):
            </Text>

            <Text style={styles.step}>1. Google Cloud Console</Text>
            <Text style={styles.stepBody}>
              APIs &amp; Services › Credentials › Create Credentials › OAuth client ID (Web application).
            </Text>

            <Text style={styles.step}>2. Authorized redirect URI</Text>
            <Text selectable style={styles.code}>
              {`https://${projectHost}/auth/v1/callback`}
            </Text>

            <Text style={styles.step}>3. Supabase Dashboard</Text>
            <Text style={styles.stepBody}>
              Authentication › Providers › Google: enable it, paste the Client ID and Client Secret, Save.
            </Text>

            <Text style={styles.step}>4. Allow the app redirect</Text>
            <Text style={styles.stepBody}>
              Authentication › URL Configuration › Redirect URLs, add:
            </Text>
            <Text selectable style={styles.code}>
              {getAuthRedirectUrl()}
            </Text>
            <Text style={styles.stepBody}>
              (In Expo Go this is an exp:// address that changes with your network. A development or
              production build uses folio://auth-callback.)
            </Text>
          </View>
        )}

        <View style={styles.stats}>
          <View style={styles.statCard}>
            <View style={styles.statHead}>
              <Icon name="local_fire_department" size={16} color={colors.primary} />
              <Text style={[styles.statLabel, { color: colors.primary }]}>STREAK</Text>
            </View>
            <Text style={styles.statValue}>{goal.streakDays} Days</Text>
            <Text style={styles.statSub}>Keep it going</Text>
          </View>

          <View style={styles.statCard}>
            <View style={styles.statHead}>
              <Icon name="menu_book" size={16} color={colors.tertiaryContainer} />
              <Text style={[styles.statLabel, { color: colors.tertiaryContainer }]}>FINISHED</Text>
            </View>
            <Text style={styles.statValue}>
              {goal.booksFinishedYear} / {goal.yearTargetBooks}
            </Text>
            <Text style={styles.statSub}>
              {Math.round((goal.booksFinishedYear / Math.max(1, goal.yearTargetBooks)) * 100)}% of annual goal
            </Text>
          </View>
        </View>

      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={() => setShowSetupGuide(!showSetupGuide)} style={styles.helpRow}>
          <Icon name="info" size={16} color={colors.muted} />
          <Text style={[styles.helpText, { color: colors.muted }]}>Setup guide</Text>
        </Pressable>
        <Pressable onPress={onClose} style={styles.doneBtn}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </ModalShell>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  header: {
    padding: 16,
    backgroundColor: colors.surfaceLow,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { ...type.labelSm, color: colors.muted, letterSpacing: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  userCard: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  avatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: colors.border },
  guestAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceLow,
  },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: { color: '#fff', fontSize: 9, lineHeight: 11 },
  name: { fontFamily: F.serifSemi, fontSize: 20, lineHeight: 26, color: colors.onSurface },
  email: { fontFamily: F.sans, fontSize: 12, color: colors.muted },
  authRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  authBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
  },
  authDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald },
  authBadgeText: { fontFamily: F.sansSemi, fontSize: 11, color: colors.emerald },
  signOut: { fontFamily: F.sansMedium, fontSize: 11, color: colors.primary },
  libraryBackup: {
    width: '100%',
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backupHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  backupTitle: { ...type.labelLg },
  backupDescription: { ...type.bodySm },
  restoreProgress: { width: '100%', gap: 6, marginTop: 4 },
  restoreProgressLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  restoreProgressText: { ...type.bodySm, flexShrink: 1 },
  restoreResult: { width: '100%', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 2 },
  restoreResultTitle: { ...type.labelMd },
  restoreFailure: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  restoreFailureText: { flex: 1, gap: 2 },
  restoreFailureTitle: { ...type.bodyMd },
  backupActions: { flexDirection: 'row', gap: 8, marginTop: 3 },
  backupButton: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 999,
  },
  backupButtonText: { ...type.labelMd },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(28,28,24,0.15)',
  },
  googleText: { fontFamily: F.sansSemi, fontSize: 12, color: colors.onSurface },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  helpText: { fontFamily: F.sansMedium, fontSize: 11, color: colors.primary },
  guide: {
    padding: 16,
    backgroundColor: colors.surfaceContainer,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 6,
  },
  guideHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  guideTitle: { fontFamily: F.sansSemi, fontSize: 12, color: colors.primary },
  guideIntro: { fontFamily: F.sans, fontSize: 11, lineHeight: 16, color: colors.muted },
  step: { fontFamily: F.sansSemi, fontSize: 11, color: colors.onSurface, marginTop: 4 },
  stepBody: { fontFamily: F.sans, fontSize: 10.5, lineHeight: 15, color: colors.muted },
  code: {
    fontFamily: F.mono,
    fontSize: 10,
    backgroundColor: colors.surface,
    padding: 6,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.onSurface,
  },
  stats: { padding: 16, flexDirection: 'row', gap: 12, backgroundColor: colors.surfaceLow },
  statCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  statLabel: { fontFamily: F.sansSemi, fontSize: 11, letterSpacing: 0.8 },
  statValue: { fontFamily: F.serifSemi, fontSize: 22, lineHeight: 28, color: colors.onSurface },
  statSub: { fontFamily: F.sans, fontSize: 11, color: colors.muted },
  footer: {
    padding: 12,
    backgroundColor: colors.surfaceLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderMid,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  doneBtn: { backgroundColor: colors.primaryContainer, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  doneText: { fontFamily: F.sansSemi, fontSize: 12, color: '#fff' },
});
