import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { PreparedBackup } from '../lib/portableBackup';
import { colors, F, type } from '../theme';
import { AppPalette, useAppTheme } from '../AppTheme';
import { ReadingGoal, UserProfile } from '../types';
import { LibraryRestoreProgress, LibraryRestoreResult } from '../lib/catalog';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';
import { ProgressBar } from './ui/ProgressBar';

interface ProfileModalProps {
  goal: ReadingGoal;
  libraryStatus: 'loading' | 'ready' | 'error';
  bookCount: number;
  user: UserProfile | null;
  onClose: () => void;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onBackupLibrary: () => Promise<number>;
  onRestoreLibrary: (onProgress: (progress: LibraryRestoreProgress) => void) => Promise<LibraryRestoreResult | null>;
  onChooseSafetyCopy?: () => Promise<PreparedBackup | null>;
  onExportSafetyCopy?: (includeOriginals: boolean) => void;
  onRestoreSafetyCopy?: (copy: PreparedBackup, preferences: boolean, recoverMatching?: boolean) => void;
  syncSummary?: string;
  onReviewConflicts?: () => void;
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
  libraryStatus,
  bookCount,
  user,
  onClose,
  onGoogleSignIn,
  onSignOut,
  onBackupLibrary,
  onRestoreLibrary,
  onChooseSafetyCopy, onExportSafetyCopy, onRestoreSafetyCopy,
  syncSummary, onReviewConflicts,
  showToast,
}) => {
  const colors = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [action, setAction] = useState<'signin' | 'signout' | 'backup' | 'restore' | 'choose-copy' | null>(null);
  const pending = useRef(false);
  const operationId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<LibraryRestoreProgress | null>(null);
  const [restoreResult, setRestoreResult] = useState<LibraryRestoreResult | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [recoverMatching, setRecoverMatching] = useState(true);
  const [safetyCopy, setSafetyCopy] = useState<PreparedBackup | null>(null);
  const [includeOriginals, setIncludeOriginals] = useState(true);
  const [restorePreferences, setRestorePreferences] = useState(false);
  const isSigningIn = action === 'signin';
  const libraryAction = action === 'backup' || action === 'restore' ? action : null;
  const busy = action !== null;
  const libraryUnavailable = libraryStatus !== 'ready' || busy;
  const close = () => { if (!pending.current) onClose(); };

  const runAction = async (kind: NonNullable<typeof action>, operation: (token: number) => Promise<string>) => {
    if (!mounted.current || pending.current) return;
    if ((kind === 'backup' || kind === 'restore') && (!user || libraryStatus !== 'ready')) return;
    const token = ++operationId.current;
    if (kind === 'backup' && bookCount === 0) return;
    pending.current = true; setAction(kind); setActionError(null); setActionMessage(null);
    try {
      const message = await operation(token);
      if (mounted.current && message) { setActionMessage(message); showToast(message); }
    } catch (error) {
      if (mounted.current) setActionError(error instanceof Error ? error.message : 'This account action could not be completed. Try again.');
    } finally {
      pending.current = false;
      if (mounted.current) setAction(null);
    }
  };
  const handleSignIn = () => runAction('signin', async () => { await onGoogleSignIn(); return ''; });
  const handleSignOut = () => runAction('signout', async () => { await onSignOut(); return 'Signed out of Folio'; });
  const handleBackupLibrary = () => runAction('backup', async () => {
    setRestoreProgress(null); setRestoreResult(null);
    const count = await onBackupLibrary();
    return `Backed up ${count} ${count === 1 ? 'book' : 'books'} to your account`;
  });
  const handleRestoreLibrary = () => runAction('restore', async token => {
    setRestoreResult(null);
    setRestoreProgress({ current: 0, total: 0, percent: 0, title: 'Loading your backup…', phase: 'loading' });
    const result = await onRestoreLibrary(progress => { if (mounted.current && pending.current && operationId.current === token) setRestoreProgress(progress); });
    if (!mounted.current) return '';
    if (!result) { setRestoreProgress(null); return 'No library backup found for this account'; }
    setRestoreResult(result);
    setRestoreProgress(null);
    return `Restored ${result.restored}; ${result.alreadyInLibrary} already in Library; ${result.failures.length} need attention.`;
  });
  const chooseSafetyCopy = () => runAction('choose-copy', async () => {
    setSafetyCopy(null);
    const copy = await onChooseSafetyCopy?.();
    if (mounted.current && copy) { setSafetyCopy(copy); setRestorePreferences(false); }
    return '';
  });

  return (
    <ModalShell onClose={close} maxWidth={384} cardStyle={{ maxHeight: '90%' }}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="account_circle" size={22} color={colors.primary} />
          <Text accessibilityRole="header" style={styles.headerTitle}>Account</Text>
        </View>
        <Pressable onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel="Close account" accessibilityState={{ disabled: busy }} style={styles.closeBtn}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <ScrollView style={{ flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled">
        {actionError && <Text accessibilityRole="alert" style={styles.feedback}>{actionError}</Text>}
        {actionMessage && <Text accessibilityLiveRegion="polite" style={styles.feedback}>{actionMessage}</Text>}
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
          {syncSummary && <Text accessibilityLiveRegion="polite" style={styles.backupDescription}>{syncSummary}</Text>}
          {onReviewConflicts && <Pressable accessibilityRole="button" accessibilityLabel="Review account changes" disabled={busy} onPress={() => { if (!pending.current) onReviewConflicts(); }} style={styles.helpRow}><Text style={styles.helpText}>Review conflicting versions</Text></Pressable>}

          {user ? (
            <View style={styles.authRow}>
              <View style={styles.authBadge}>
                <View style={styles.authDot} />
                <Text style={styles.authBadgeText}>Signed in</Text>
              </View>
              <Pressable onPress={handleSignOut} disabled={busy} accessibilityRole="button" accessibilityLabel="Sign out of Folio" accessibilityState={{ disabled: busy, busy: action === 'signout' }} style={styles.smallAction}>
                <Text style={styles.signOut}>{action === 'signout' ? 'Signing out…' : 'Sign Out'}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ width: '100%', marginTop: 12, gap: 8 }}>
              <Pressable onPress={handleSignIn} disabled={busy} accessibilityRole="button" accessibilityLabel="Sign in with Google" accessibilityState={{ disabled: busy, busy: isSigningIn }} style={[styles.googleBtn, busy && { opacity: 0.6 }]}>
                <GoogleG />
                <Text style={styles.googleText}>
                  {isSigningIn ? 'Connecting to Google...' : 'Sign in with Google'}
                </Text>
              </Pressable>
              <Text style={{ ...type.bodySm, color: colors.muted }}>
                Signing in opens a separate reading space. Guest books and notes stay in Guest on this device.
              </Text>
              <Pressable onPress={() => setShowSetupGuide(!showSetupGuide)} accessibilityRole="button" accessibilityLabel="Account help" accessibilityState={{ expanded: showSetupGuide }} style={styles.helpRow}>
                <Icon name="help" size={14} color={colors.primary} />
                <Text style={styles.helpText}>
                  {showSetupGuide ? 'Hide account help' : 'How reading spaces work'}
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
                Back up your book list and reading progress. EPUB files stay on this device.
                Restore re-downloads matching Gutenberg editions; other editions may need their original EPUB.
              </Text>
              {libraryStatus === 'ready' && bookCount === 0 && <Text style={styles.backupDescription}>Add or restore a book before backing up. An empty library will not replace your account backup.</Text>}
              {libraryStatus !== 'ready' && <Text accessibilityLiveRegion="polite" style={styles.backupDescription}>{libraryStatus === 'loading' ? 'Loading your saved library before backup or restore…' : 'Your saved library could not be loaded. Restart Folio before backup or restore.'}</Text>}
              {libraryAction === 'restore' && restoreProgress ? (
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
                      ? `Restore complete: ${restoreResult.restored} added; ${restoreResult.alreadyInLibrary} already in Library`
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
                  accessibilityRole="button" accessibilityLabel="Back up library" accessibilityState={{ disabled: libraryUnavailable || bookCount === 0, busy: action === 'backup' }}
                  disabled={libraryUnavailable || bookCount === 0}
                  style={[
                    styles.backupButton,
                    { backgroundColor: colors.primaryContainer },
                    libraryAction && { opacity: 0.6 },
                  ]}
                >
                  <Icon name={libraryAction === 'backup' ? 'sync' : 'cloud_upload'} size={17} color={colors.onPrimaryContainer} spin={libraryAction === 'backup'} />
                  <Text style={[styles.backupButtonText, { color: colors.onPrimaryContainer }]}>
                    {libraryAction === 'backup' ? 'Backing up…' : 'Back up'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleRestoreLibrary}
                  accessibilityRole="button" accessibilityLabel="Restore library" accessibilityState={{ disabled: libraryUnavailable, busy: action === 'restore' }}
                  disabled={libraryUnavailable}
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

        {onChooseSafetyCopy && onExportSafetyCopy && onRestoreSafetyCopy && <View style={styles.guide}>
          <Text accessibilityRole="header" style={styles.guideTitle}>Portable safety copy</Text>
          <Text style={styles.guideIntro}>Save notes, vocabulary, bookmarks, reading settings, and available book text and covers in a ZIP file. Keep the file somewhere you trust; it contains your private reading work.</Text>
          <Pressable accessibilityRole="checkbox" accessibilityLabel="Include original EPUB files" accessibilityState={{ checked: includeOriginals, disabled: busy }} disabled={busy} onPress={() => setIncludeOriginals(value => !value)} style={styles.helpRow}>
            <Text style={styles.helpText}>{includeOriginals ? '☑' : '☐'} Include original EPUB files</Text>
          </Pressable>
          <View style={styles.backupActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Export safety copy" disabled={libraryUnavailable} accessibilityState={{ disabled: libraryUnavailable }} style={styles.backupButton} onPress={() => { if (!pending.current && libraryStatus === 'ready') onExportSafetyCopy(includeOriginals); }}><Text style={styles.backupButtonText}>Export copy</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose safety copy" disabled={libraryUnavailable} accessibilityState={{ disabled: libraryUnavailable, busy: action === 'choose-copy' }} style={styles.backupButton} onPress={chooseSafetyCopy}><Text style={styles.backupButtonText}>{action === 'choose-copy' ? 'Checking…' : 'Choose a copy'}</Text></Pressable>
          </View>
          <Text style={styles.guideIntro}>Up to 48 MB per ZIP file. Export closes the reader while preparing a consistent copy. A sharing destination must save the file before you leave its save flow.</Text>
          {safetyCopy && <View style={styles.restoreProgress}>
            <Text accessibilityRole="header" style={styles.restoreResultTitle}>Review this safety copy</Text>
            <Text style={styles.guideIntro}>{safetyCopy.summary.books} books · {safetyCopy.summary.originals} original EPUBs · {safetyCopy.summary.readable} with reading text{ '\n' }{safetyCopy.summary.highlights} notes/highlights · {safetyCopy.summary.vocabulary} vocabulary cards · {safetyCopy.summary.bookmarks} bookmarks</Text>
            <Pressable accessibilityRole="checkbox" accessibilityLabel="Recover matching editions without duplicate books" accessibilityState={{ checked: recoverMatching, disabled: busy }} disabled={busy} onPress={() => setRecoverMatching(value => !value)} style={styles.helpRow}><Text style={styles.helpText}>{recoverMatching ? '☑' : '☐'} Recover matching editions</Text></Pressable>
            <Text style={styles.guideIntro}>{recoverMatching ? 'Matching identifiers and editions recover missing files. Current progress and existing notes take priority; removed records stay removed. Different or older editions become separate copies.' : 'Every book becomes a separate copy. Repeating restore adds more copies.'}</Text>
            <Text style={styles.guideIntro}>Books without reading text need their original EPUB.</Text>
            <Pressable accessibilityRole="checkbox" accessibilityLabel="Use reading settings from safety copy" accessibilityState={{ checked: restorePreferences, disabled: busy }} disabled={busy} onPress={() => setRestorePreferences(value => !value)} style={styles.helpRow}><Text style={styles.helpText}>{restorePreferences ? '☑' : '☐'} Use its reading settings</Text></Pressable>
            <View style={styles.backupActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={recoverMatching ? "Recover books from safety copy" : "Restore safety copy as separate books"} disabled={libraryUnavailable} accessibilityState={{ disabled: libraryUnavailable }} style={styles.backupButton} onPress={() => { if (!pending.current && libraryStatus === 'ready') onRestoreSafetyCopy(safetyCopy, restorePreferences, recoverMatching); }}><Text style={styles.backupButtonText}>{recoverMatching ? 'Recover books' : 'Restore copies'}</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel safety copy restore" disabled={busy} style={styles.backupButton} onPress={() => setSafetyCopy(null)}><Text style={styles.backupButtonText}>Cancel</Text></Pressable>
            </View>
          </View>}
        </View>}

        {showSetupGuide && (
          <View style={styles.guide}>
            <View style={styles.guideHead}>
              <Icon name="tune" size={16} color={colors.primary} />
              <Text style={styles.guideTitle}>Your reading space</Text>
            </View>
            <Text style={styles.guideIntro}>
              Guest and signed-in reading spaces keep separate books and notes on this device. Signing out returns to Guest. Sign in again to reopen your account’s local space.
            </Text>

            <Text style={styles.step}>Account backup</Text>
            <Text style={styles.stepBody}>
              Account library backup saves the book list and basic reading progress. It does not contain your original EPUB files or a complete copy of your saved work. Keep a portable safety copy for those.
            </Text>

            <Text style={styles.step}>Sign-in trouble</Text>
            <Text style={styles.stepBody}>
              Check your connection and try again. Your existing local reading space is kept when sign-in fails.
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

      <View style={styles.footer}>
        <Pressable onPress={() => setShowSetupGuide(!showSetupGuide)} accessibilityRole="button" accessibilityLabel="Account help" accessibilityState={{ expanded: showSetupGuide }} style={styles.helpRow}>
          <Icon name="info" size={16} color={colors.muted} />
          <Text style={[styles.helpText, { color: colors.muted }]}>Account help</Text>
        </Pressable>
        <Pressable onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel="Done with account" accessibilityState={{ disabled: busy }} style={styles.doneBtn}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
      </ScrollView>
    </ModalShell>
  );
};

const createStyles = (colors: AppPalette) => StyleSheet.create({
  header: {
    paddingLeft: 16,
    paddingRight: 8,
    backgroundColor: colors.surfaceLow,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { ...type.bodyMd, color: colors.onSurface, flexShrink: 1 },
  closeBtn: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  userCard: {
    padding: 16,
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
  authRow: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8 },
  authBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 8,
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
  backupDescription: { ...type.bodySm, color: colors.muted },
  restoreProgress: { width: '100%', gap: 6, marginTop: 4 },
  restoreProgressLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  restoreProgressText: { ...type.bodySm, flexShrink: 1 },
  restoreResult: { width: '100%', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 2 },
  restoreResultTitle: { ...type.labelMd, color: colors.onSurface },
  restoreFailure: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  restoreFailureText: { flex: 1, gap: 2 },
  restoreFailureTitle: { ...type.bodyMd },
  backupActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  backupButton: {
    flexGrow: 1,
    flexBasis: 112,
    minWidth: 112,
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.borderMid,
    borderRadius: 8,
  },
  backupButtonText: { ...type.labelMd, color: colors.onSurface, flexShrink: 1, textAlign: 'center' },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(28,28,24,0.15)',
  },
  googleText: { ...type.labelMd, color: colors.onSurface, flexShrink: 1 },
  feedback: { ...type.bodySm, color: colors.onSurface, padding: 16 },
  smallAction: { minHeight: 48, minWidth: 48, justifyContent: 'center' },
  helpRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
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
  stats: { padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: colors.surfaceLow },
  statCard: {
    flexGrow: 1,
    flexBasis: 128,
    minWidth: 128,
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
  doneBtn: { minHeight: 48, justifyContent: 'center', backgroundColor: colors.primaryContainer, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  doneText: { fontFamily: F.sansSemi, fontSize: 12, color: '#fff' },
});
