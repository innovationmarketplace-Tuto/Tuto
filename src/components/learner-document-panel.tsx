import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDocumentAnalysis } from '@/hooks/use-document-analysis';
import type { LocalDocumentAsset } from '@/features/document-import/upload';
import type { LearnerDocumentContext } from '@/features/workspace/types';
import { Button, EmptyState, InlineNotice, LoadingLines, Pill, ProductIcon, ProductText, Surface } from '@/components/product-primitives';

/**
 * Production learner-page capture. It deliberately owns no fixture page and
 * talks to the durable upload/job subscription hook, which restores the
 * learner's latest persisted page and job after route changes or reconnects.
 */
export function LearnerDocumentPanel({
  studentId,
  onContextChange,
}: {
  studentId: string;
  onContextChange: (context: LearnerDocumentContext | null) => void;
}) {
  const theme = useTheme();
  const analysis = useDocumentAnalysis(studentId);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    setActiveRegionId(null);
    setPickerError(null);
    onContextChange(null);
  }, [onContextChange, studentId]);

  useEffect(() => {
    if (!analysis.isComplete) return;
    setActiveRegionId((current) => (
      current && analysis.regions.some((region) => region.id === current)
        ? current
        : analysis.regions[0]?.id ?? null
    ));
  }, [analysis.isComplete, analysis.regions]);

  useEffect(() => {
    if (!analysis.isComplete || !analysis.workflow) {
      onContextChange(null);
      return;
    }
    onContextChange({
      pageId: String(analysis.workflow.pageId),
      pageRevision: analysis.workflow.pageRevision,
      activeRegionIds: activeRegionId ? [activeRegionId] : [],
    });
  }, [activeRegionId, analysis.isComplete, analysis.workflow, onContextChange]);

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
      const localAsset: LocalDocumentAsset = {
        uri: asset.uri,
        name: asset.fileName,
        mimeType: asset.mimeType,
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
        file: asset.file ?? null,
      };
      await analysis.start({
        asset: localAsset,
        kind: 'scan',
        title: `${studentId} worksheet`,
      });
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'The page picker could not be opened.');
    }
  }, [analysis, studentId]);

  const retryAnalysis = useCallback(() => {
    void analysis.retry();
  }, [analysis]);

  const error = pickerError ?? analysis.error;
  const hasWorkflow = Boolean(analysis.workflow);
  const isChoosing = analysis.isUploading || analysis.isProcessing;
  const imageUrl = analysis.page?.imageUrl;

  return (
    <Surface style={[styles.panel, { backgroundColor: theme.backgroundElement }]} elevated>
      <View style={styles.header}>
        <View style={styles.heading}>
          <View style={[styles.icon, { backgroundColor: theme.primarySoft }]}><ProductIcon name="scan" size={18} color={theme.primary} /></View>
          <View style={styles.headingCopy}>
            <ProductText variant="bodyMedium">My work</ProductText>
            <ProductText variant="caption" color={theme.textSecondary}>Add a worksheet or photo and I&apos;ll keep it with your learning.</ProductText>
          </View>
        </View>
        {analysis.isComplete ? <Pill tone="mint" icon="check">Ready</Pill> : null}
      </View>

      {error ? (
        <InlineNotice
          tone="danger"
          icon="refresh"
          action={hasWorkflow && analysis.retryable ? <Button tone="danger" onPress={retryAnalysis}>Retry analysis</Button> : <Button tone="danger" onPress={() => void choosePage()}>Choose again</Button>}
        >
          {error}
        </InlineNotice>
      ) : null}

      {isChoosing ? (
        <View style={styles.progress}>
          <View style={styles.progressCopy}>
            <ProductIcon name="clock" size={16} color={theme.primary} />
            <ProductText variant="bodyMedium">{phaseLabel(analysis.phase)}</ProductText>
          </View>
          <LoadingLines lines={2} />
          {hasWorkflow ? <Button tone="outline" onPress={() => void analysis.cancel()}>Cancel</Button> : null}
        </View>
      ) : null}

      {!hasWorkflow && !error && !isChoosing ? (
        <EmptyState
          icon="scan"
          title="Bring in your work"
          detail="Take a photo of a worksheet or note. I&apos;ll look it over and keep the useful context with your tutor."
          action={<Button icon="plus" onPress={() => void choosePage()}>Add worksheet or photo</Button>}
        />
      ) : null}

      {analysis.isComplete ? (
        <View style={styles.result}>
          {imageUrl ? (
            <Image
              accessibilityLabel="Your uploaded worksheet or photo"
              source={imageUrl}
              contentFit="contain"
              style={styles.pageImage}
            />
          ) : analysis.isLoadingPage ? <LoadingLines lines={4} /> : <InlineNotice tone="danger">I couldn&apos;t show that photo right now.</InlineNotice>}
            <View style={styles.resultMeta}>
            <View style={styles.resultTitle}><ProductText variant="bodyMedium">What I noticed</ProductText><Pill tone="neutral">Saved</Pill></View>
            {analysis.isLoadingRegions ? <LoadingLines lines={2} /> : analysis.regions.length === 0 ? <ProductText variant="caption" color={theme.textSecondary}>I didn&apos;t find separate parts yet, but you can still ask your tutor about this work.</ProductText> : (
              <View style={styles.regionList}>
                {analysis.regions.map((region, index) => (
                  <Pressable
                    key={region.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: activeRegionId === region.id }}
                    accessibilityLabel={`Focus on ${regionLabel(region.kind, index)}`}
                    onPress={() => setActiveRegionId(region.id)}
                    style={({ pressed }) => [styles.regionRow, { borderColor: activeRegionId === region.id ? theme.primary : theme.border, backgroundColor: activeRegionId === region.id ? theme.primarySoft : theme.backgroundElement }, pressed && styles.pressed]}
                  >
                    <View style={[styles.regionDot, { backgroundColor: activeRegionId === region.id ? theme.primary : theme.border }]} />
                    <View style={styles.regionCopy}><ProductText variant="caption">{regionLabel(region.kind, index)}</ProductText><ProductText variant="caption" color={theme.textSecondary} numberOfLines={1}>{region.transcription ?? 'Part of your work'}</ProductText></View>
                    {activeRegionId === region.id ? <ProductIcon name="check" size={15} color={theme.primary} /> : null}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
          <Button tone="outline" icon="scan" onPress={() => void choosePage()}>Replace photo</Button>
        </View>
      ) : null}
    </Surface>
  );
}

function phaseLabel(phase: ReturnType<typeof useDocumentAnalysis>['phase']): string {
  switch (phase) {
    case 'uploading': return 'Adding your work…';
    case 'submitting': return 'Getting it ready…';
    case 'scheduled': return 'Getting it ready…';
    case 'running': return 'Looking it over…';
    default: return 'Preparing your work…';
  }
}

function regionLabel(kind: string, index: number): string {
  const title = kind.replace(/_/g, ' ');
  return `${title.charAt(0).toUpperCase()}${title.slice(1)} ${index + 1}`;
}

const styles = StyleSheet.create({
  panel: { padding: Spacing.three, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headingCopy: { flex: 1, gap: 2 },
  icon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  progress: { gap: Spacing.two, paddingVertical: Spacing.two },
  progressCopy: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  result: { gap: Spacing.three },
  pageImage: { width: '100%', height: 260, borderRadius: 14, backgroundColor: '#F6F8FC' },
  resultMeta: { gap: Spacing.two },
  resultTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  regionList: { gap: 7 },
  regionRow: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  regionDot: { width: 8, height: 8, borderRadius: 4 },
  regionCopy: { flex: 1, minWidth: 0, gap: 1 },
  pressed: { opacity: 0.75 },
});
