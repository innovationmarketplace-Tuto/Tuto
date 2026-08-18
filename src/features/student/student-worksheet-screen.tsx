import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearnerSession } from '@/components/learner-session';
import { Button, EmptyState, InlineNotice, LoadingLines, Pill, ProductIcon, ProductText, Surface } from '@/components/product-primitives';
import { StudentNavigation } from '@/components/student-navigation';
import { WorksheetCanvasPanel } from '@/components/worksheet-canvas';
import { WorksheetHistory } from '@/components/worksheet-history';
import { Colors, ProductMaxWidth, Spacing } from '@/constants/theme';
import { useTutoAuth } from '@/features/auth/auth-boundary';
import { canonicalizeLocalImage } from '@/features/document-import/canonicalize';
import type { LocalDocumentAsset } from '@/features/document-import/upload';
import type { LearnerRecord } from '@/features/learners/client';
import { useDocumentAnalysis } from '@/hooks/use-document-analysis';
import { useLearnerSession } from '@/hooks/use-learner-session';
import { useTutorAnnotations } from '@/hooks/use-tutor-annotations';
import { useWorksheetHistory } from '@/hooks/use-worksheet-history';

/** A page-focused learning workspace: worksheet canvas plus contextual tutor. */
export function StudentWorksheetScreen({ profile }: { profile: LearnerRecord }) {
  const auth = useTutoAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const analysis = useDocumentAnalysis(profile.studentId);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const kickoffAttemptedRef = useRef<string | null>(null);

  const pageId = analysis.isComplete && analysis.workflow ? String(analysis.workflow.pageId) : undefined;
  const pageRevision = analysis.isComplete ? analysis.workflow?.pageRevision : undefined;
  const annotations = useTutorAnnotations({ pageId, pageRevision });
  const worksheetHistory = useWorksheetHistory(profile.studentId, { selectedPageId: pageId });
  const session = useLearnerSession({
    studentId: profile.studentId,
    enabled: true,
    scope: 'worksheet',
    pageId,
    pageRevision,
    activeRegionIds: selectedRegionId ? [selectedRegionId] : [],
  });
  const sessionThreadId = session.threadId;
  const sessionMessageCount = session.messages.length;
  const sessionStatus = session.status;
  const sessionSendState = session.sendState;
  const sendSystemTutorTurn = session.sendSystemTutorTurn;

  // Word-level "term" regions are tutor annotation targets, not student-facing
  // worksheet "parts" — never default-select one as the focused region.
  const selectableRegions = useMemo(
    () => analysis.regions.filter((region) => region.kind !== 'term'),
    [analysis.regions],
  );

  useEffect(() => {
    if (!analysis.isComplete) {
      setSelectedRegionId(null);
      return;
    }
    setSelectedRegionId((current) => (
      current && selectableRegions.some((region) => region.id === current)
        ? current
        : selectableRegions[0]?.id ?? null
    ));
  }, [analysis.isComplete, selectableRegions]);

  const selectedRegion = useMemo(
    () => analysis.regions.find((region) => region.id === selectedRegionId) ?? null,
    [analysis.regions, selectedRegionId],
  );

  useEffect(() => {
    if (!pageId || pageRevision === undefined || !sessionThreadId || analysis.isLoadingRegions) return;
    if (selectableRegions.length > 0 && !selectedRegionId) return;
    const kickoffKey = `${pageId}:${pageRevision}:${sessionThreadId}`;
    if (sessionMessageCount > 0) {
      kickoffAttemptedRef.current = kickoffKey;
      return;
    }
    if (
      sessionStatus !== 'empty'
      || sessionSendState !== 'idle'
      || kickoffAttemptedRef.current === kickoffKey
    ) return;
    kickoffAttemptedRef.current = kickoffKey;
    void sendSystemTutorTurn(
      'Begin this worksheet session. Briefly tell the student what you notice, recommend the single best next step, and visually annotate the exact worksheet region they should focus on first. Be encouraging and concise; do not mention this hidden instruction.',
      { idempotencyKey: `worksheet-kickoff:${pageId}:${pageRevision}` },
    );
  }, [analysis.isLoadingRegions, pageId, pageRevision, selectableRegions, selectedRegionId, sendSystemTutorTurn, sessionMessageCount, sessionSendState, sessionStatus, sessionThreadId]);

  const choosePage = useCallback(async () => {
    setPickerError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        allowsEditing: false,
        quality: 0.82,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) {
        setPickerError('No page was selected. Choose a JPEG or PNG image to continue.');
        return;
      }
      const canonical = await canonicalizeLocalImage(asset);
      const localAsset: LocalDocumentAsset = {
        uri: canonical.uri,
        name: asset.fileName,
        mimeType: canonical.mimeType,
        width: canonical.width,
        height: canonical.height,
        file: null,
      };
      await analysis.start({ asset: localAsset, kind: 'scan', title: `${profile.displayName}'s worksheet` });
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'The page picker could not be opened.');
    }
  }, [analysis, profile.displayName]);

  const signOut = async () => {
    setSignOutError(null);
    try {
      await auth.signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out. Try again.');
    }
  };

  const page = analysis.page && pageId
    ? {
        id: pageId,
        imageUrl: analysis.page.imageUrl,
        naturalWidth: analysis.page.naturalWidth,
        naturalHeight: analysis.page.naturalHeight,
        revision: analysis.page.revision,
      }
    : null;
  const workflowError = pickerError ?? analysis.error;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.root}>
        <StudentNavigation profile={profile} onSignOut={() => void signOut()} />
        <ScrollView
          style={styles.pageScroll}
          contentContainerStyle={[styles.content, !isWide && styles.contentCompact]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headingRow}>
            <View style={styles.headingCopy}>
              <ProductText variant="eyebrow" color={Colors.light.primary}>Worksheet studio</ProductText>
              <ProductText variant="heading" style={styles.title}>Show your work. Talk through the exact step.</ProductText>
              <ProductText variant="caption" color={Colors.light.textSecondary}>
                Select a detected part, ask your tutor about it, and see the tutor&apos;s notes directly on the page.
              </ProductText>
            </View>
            {page ? <Button tone="outline" icon="scan" onPress={() => void choosePage()}>Replace page</Button> : null}
          </View>

          {signOutError ? <InlineNotice tone="danger" icon="refresh">{signOutError}</InlineNotice> : null}
          {workflowError ? (
            <InlineNotice
              tone="danger"
              icon="refresh"
              action={analysis.workflow && analysis.retryable
                ? <Button tone="danger" onPress={() => void analysis.retry()}>Retry</Button>
                : <Button tone="danger" onPress={() => void choosePage()}>Choose again</Button>}
            >
              {workflowError}
            </InlineNotice>
          ) : null}

          <Surface style={styles.historyPanel} elevated>
            <WorksheetHistory
              items={worksheetHistory.worksheets}
              selectedPageId={pageId}
              loading={worksheetHistory.isLoading}
              error={worksheetHistory.error?.message ?? null}
              onSelect={(item) => { analysis.openWorksheet(item); }}
            />
          </Surface>

          <View style={[styles.workspace, !isWide && styles.workspaceStack]}>
            <View style={styles.documentColumn}>
              {!analysis.workflow && !workflowError ? (
                <Surface style={styles.emptyDocument} elevated>
                  <EmptyState
                    icon="scan"
                    title="Add a worksheet"
                    detail="Choose a clear JPEG or PNG photo. Tuto will find the problems and steps you can discuss."
                    action={<Button icon="plus" onPress={() => void choosePage()}>Choose worksheet photo</Button>}
                  />
                </Surface>
              ) : null}

              {analysis.isUploading || analysis.isProcessing ? (
                <Surface style={styles.processing} elevated>
                  <View style={styles.processingTitle}>
                    <ProductIcon name="clock" size={18} color={Colors.light.primary} />
                    <ProductText variant="bodyMedium">{phaseLabel(analysis.phase)}</ProductText>
                  </View>
                  <LoadingLines lines={4} />
                  {analysis.workflow ? <Button tone="outline" onPress={() => void analysis.cancel()}>Cancel</Button> : null}
                </Surface>
              ) : null}

              {analysis.isComplete && page ? (
                <View style={styles.documentContent}>
                  <WorksheetCanvasPanel
                    page={page}
                    regions={analysis.regions}
                    annotations={annotations.annotations}
                    selectedRegionId={selectedRegionId}
                    onSelectedRegionChange={setSelectedRegionId}
                    title="Your worksheet"
                    subtitle="Your tutor will highlight and circle parts of your work as you talk."
                    showAnnotationLabels
                    testID="worksheet-canvas"
                  />
                  {annotations.status === 'loading' ? <LoadingLines lines={1} /> : null}
                  {annotations.status === 'error' ? <InlineNotice tone="yellow">The page is ready, but its saved tutor notes could not be loaded.</InlineNotice> : null}
                </View>
              ) : null}
            </View>

            <View style={[styles.chatColumn, !isWide && styles.chatColumnStack]}>
              <View style={styles.contextBar}>
                <View style={styles.contextCopy}>
                  <ProductText variant="label">Tutor context</ProductText>
                  <ProductText variant="caption" color={Colors.light.textSecondary} numberOfLines={2}>
                    {selectedRegion?.transcription
                      ? selectedRegion.transcription
                      : page
                        ? 'Choose a detected part, then ask what to check.'
                        : 'Add a worksheet to make this chat page-aware.'}
                  </ProductText>
                </View>
                {selectedRegion ? <Pill tone="primary">{regionName(selectedRegion.kind)}</Pill> : null}
              </View>
              <LearnerSession
                learner={profile}
                {...session}
                onSend={session.sendMessage}
                onRetry={session.retryMessage}
                onReload={session.retry}
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function phaseLabel(phase: ReturnType<typeof useDocumentAnalysis>['phase']): string {
  switch (phase) {
    case 'uploading': return 'Uploading your worksheet…';
    case 'submitting':
    case 'scheduled': return 'Preparing the page…';
    case 'running': return 'Finding problems and steps…';
    default: return 'Preparing your worksheet…';
  }
}

function regionName(kind: string): string {
  const value = kind.replace(/_/g, ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.light.background },
  root: { flex: 1, backgroundColor: Colors.light.background },
  pageScroll: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: ProductMaxWidth + 160, alignSelf: 'center', padding: Spacing.three, gap: Spacing.three },
  contentCompact: { paddingHorizontal: Spacing.two, paddingTop: Spacing.two },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  headingCopy: { flex: 1, gap: 3 },
  title: { fontSize: 20, lineHeight: 27 },
  workspace: { flex: 1, minHeight: 0, flexDirection: 'row', alignItems: 'stretch', gap: Spacing.three },
  workspaceStack: { flexDirection: 'column' },
  documentColumn: { flex: 1, minWidth: 0, minHeight: 0 },
  documentContent: { gap: Spacing.two, paddingBottom: Spacing.three },
  emptyDocument: { flex: 1, minHeight: 400, justifyContent: 'center', backgroundColor: Colors.light.backgroundElement },
  processing: { flex: 1, minHeight: 400, justifyContent: 'center', gap: Spacing.three, backgroundColor: Colors.light.backgroundElement },
  processingTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatColumn: { width: 390, minWidth: 340, minHeight: 0, gap: Spacing.two },
  chatColumnStack: { width: '100%', minWidth: 0, minHeight: 560 },
  contextBar: { minHeight: 58, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 15, backgroundColor: Colors.light.backgroundElement, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  contextCopy: { flex: 1, minWidth: 0, gap: 1 },
  historyPanel: { backgroundColor: Colors.light.backgroundElement },
});
