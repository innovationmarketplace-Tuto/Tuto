import { Image, type ImageSource } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { TutorAnnotation } from '@/domain/annotations';
import type { PageRegion } from '@/domain/regions';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Pill, ProductIcon, ProductText, Surface } from '@/components/product-primitives';

import {
  colorWithAlpha,
  normalizedBoundsToStyle,
  pageAspectRatio,
  regionBounds,
} from './worksheet-canvas-geometry';

/** A page shape that can be supplied directly from document analysis or Convex. */
export type WorksheetCanvasPage = {
  id: string;
  imageUrl: ImageSource | string | number;
  naturalWidth: number;
  naturalHeight: number;
  revision?: number;
};

export type WorksheetRegionLabel = (region: PageRegion, index: number) => string;
export type WorksheetAnnotationLabel = (annotation: TutorAnnotation) => string;

/** Maximum opacity used by a selected-region fill over the source page. */
const SELECTED_REGION_FILL_ALPHA = 0.12;
/** Keep annotation washes readable over black and colored source text. */
const HIGHLIGHT_FILL_ALPHA = 0.2;
const FOCUS_FILL_ALPHA = 0.08;
const CIRCLE_FILL_ALPHA = 0.06;

export type WorksheetCanvasProps = {
  /** Immutable canonical page image and its original dimensions. */
  page: WorksheetCanvasPage;
  /** Regions are normalized to the page and may include revisions from analysis. */
  regions?: readonly PageRegion[];
  /** Annotation targets are resolved by targetRegionId, never by display coordinates. */
  annotations?: readonly TutorAnnotation[];
  /** Controlled selection. Omit this prop to use defaultSelectedRegionId/uncontrolled selection. */
  selectedRegionId?: string | null;
  defaultSelectedRegionId?: string | null;
  onRegionSelect?: (region: PageRegion) => void;
  onSelectedRegionChange?: (regionId: string | null) => void;
  onAnnotationPress?: (annotation: TutorAnnotation) => void;
  regionLabel?: WorksheetRegionLabel;
  annotationLabel?: WorksheetAnnotationLabel;
  showRegions?: boolean;
  showAnnotations?: boolean;
  showAnnotationLabels?: boolean;
  /** Keep the page readable in a very wide desktop workspace. */
  maxWidth?: number;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Responsive worksheet image with normalized region hit targets and tutor
 * annotation overlays. The page uses its source aspect ratio, so percentage
 * coordinates stay aligned with the image at every screen width.
 */
export function WorksheetCanvas({
  page,
  regions = [],
  annotations = [],
  selectedRegionId,
  defaultSelectedRegionId = null,
  onRegionSelect,
  onSelectedRegionChange,
  onAnnotationPress,
  regionLabel = defaultRegionLabel,
  annotationLabel = defaultAnnotationLabel,
  showRegions = true,
  showAnnotations = true,
  showAnnotationLabels = true,
  maxWidth = 1200,
  accessibilityLabel = 'Uploaded worksheet',
  testID,
  style,
}: WorksheetCanvasProps) {
  const theme = useTheme();
  const [uncontrolledSelectedRegionId, setUncontrolledSelectedRegionId] = useState<string | null>(defaultSelectedRegionId);

  useEffect(() => {
    setUncontrolledSelectedRegionId(defaultSelectedRegionId);
  }, [defaultSelectedRegionId, page.id]);

  const pageRegions = useMemo(
    () => regions.filter((region) => region.pageId === page.id),
    [page.id, regions],
  );
  const regionById = useMemo(
    () => new Map(pageRegions.map((region) => [region.id, region])),
    [pageRegions],
  );
  const pageAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.pageId === page.id && regionById.has(annotation.targetRegionId)),
    [annotations, page.id, regionById],
  );
  const effectiveSelectedRegionId = selectedRegionId === undefined
    ? uncontrolledSelectedRegionId
    : selectedRegionId;
  const pageRatio = pageAspectRatio(page.naturalWidth, page.naturalHeight);

  const selectRegion = useCallback((region: PageRegion) => {
    if (selectedRegionId === undefined) setUncontrolledSelectedRegionId(region.id);
    onRegionSelect?.(region);
    onSelectedRegionChange?.(region.id);
  }, [onRegionSelect, onSelectedRegionChange, selectedRegionId]);

  const backgroundAnnotations = showAnnotations
    ? pageAnnotations.filter((annotation) => annotation.kind === 'highlight')
    : [];
  const foregroundAnnotations = showAnnotations
    ? pageAnnotations.filter((annotation) => annotation.kind !== 'highlight')
    : [];

  return (
    <View
      testID={testID}
      style={[styles.canvas, { aspectRatio: pageRatio, maxWidth }, style]}
    >
      <Image
        accessible
        accessibilityLabel={accessibilityLabel}
        contentFit="contain"
        source={page.imageUrl}
        style={styles.image}
      />

      <View pointerEvents="box-none" style={styles.overlay}>
        <View pointerEvents="box-none" style={styles.annotationLayer}>
          {backgroundAnnotations.map((annotation, index) => {
            const region = regionById.get(annotation.targetRegionId);
            return region ? (
              <AnnotationOverlay
                key={annotation.id}
                annotation={annotation}
                annotationIndex={index}
                annotationLabel={annotationLabel}
                onPress={onAnnotationPress}
                onRegionSelect={selectRegion}
                region={region}
                showLabel={showAnnotationLabels}
                theme={theme}
              />
            ) : null;
          })}
        </View>

        {showRegions ? (
          <View pointerEvents="box-none" style={styles.regionLayer}>
            {pageRegions.map((region, index) => {
              const isSelected = effectiveSelectedRegionId === region.id;
              const label = regionLabel(region, index);
              const palette = regionPalette(region.kind, theme);
              return (
                <Pressable
                  key={region.id}
                  accessibilityHint="Double tap to focus this part of the worksheet."
                  accessibilityLabel={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => selectRegion(region)}
                  style={({ pressed }) => [
                    normalizedBoundsToStyle(regionBounds(region)),
                    styles.regionTarget,
                    {
                      backgroundColor: isSelected
                        ? colorWithAlpha(theme.primary, SELECTED_REGION_FILL_ALPHA)
                        : palette.fill,
                      borderColor: isSelected ? theme.primary : palette.border,
                      zIndex: isSelected ? 1 : 0,
                    },
                    isSelected && styles.selectedRegionTarget,
                    pressed && styles.pressedRegionTarget,
                  ]}
                />
              );
            })}
          </View>
        ) : null}

        <View pointerEvents="box-none" style={[styles.annotationLayer, styles.foregroundAnnotationLayer]}>
          {foregroundAnnotations.map((annotation, index) => {
            const region = regionById.get(annotation.targetRegionId);
            return region ? (
              <AnnotationOverlay
                key={annotation.id}
                annotation={annotation}
                annotationIndex={index}
                annotationLabel={annotationLabel}
                onPress={onAnnotationPress}
                onRegionSelect={selectRegion}
                region={region}
                showLabel={showAnnotationLabels}
                theme={theme}
              />
            ) : null;
          })}
        </View>
      </View>
    </View>
  );
}

export type WorksheetCanvasPanelProps = Omit<WorksheetCanvasProps, 'style' | 'selectedRegionId'> & {
  /** Panel-level style. Use canvasStyle for the inner image surface. */
  style?: StyleProp<ViewStyle>;
  canvasStyle?: StyleProp<ViewStyle>;
  selectedRegionId?: string | null;
  title?: string;
  subtitle?: string;
  showRegionList?: boolean;
};

/**
 * A ready-to-place panel for a document workspace. It adds a compact region
 * navigator below WorksheetCanvas while preserving the same controlled props.
 */
export function WorksheetCanvasPanel({
  page,
  regions = [],
  annotations = [],
  selectedRegionId,
  defaultSelectedRegionId = null,
  onRegionSelect,
  onSelectedRegionChange,
  onAnnotationPress,
  regionLabel = defaultRegionLabel,
  annotationLabel = defaultAnnotationLabel,
  showRegions = true,
  showAnnotations = true,
  showAnnotationLabels = true,
  maxWidth = 1200,
  accessibilityLabel = 'Uploaded worksheet',
  testID,
  title = 'Worksheet',
  subtitle = 'Select a part of the page to focus your tutor.',
  showRegionList = true,
  style,
  canvasStyle,
}: WorksheetCanvasPanelProps) {
  const theme = useTheme();
  const [uncontrolledSelectedRegionId, setUncontrolledSelectedRegionId] = useState<string | null>(defaultSelectedRegionId);
  const isControlled = selectedRegionId !== undefined;
  const effectiveSelectedRegionId = isControlled ? selectedRegionId : uncontrolledSelectedRegionId;

  useEffect(() => {
    setUncontrolledSelectedRegionId(defaultSelectedRegionId);
  }, [defaultSelectedRegionId, page.id]);

  const pageRegions = useMemo(
    () => regions.filter((region) => region.pageId === page.id),
    [page.id, regions],
  );

  const selectRegion = useCallback((region: PageRegion) => {
    if (!isControlled) setUncontrolledSelectedRegionId(region.id);
    onRegionSelect?.(region);
    onSelectedRegionChange?.(region.id);
  }, [isControlled, onRegionSelect, onSelectedRegionChange]);

  return (
    <Surface testID={testID} style={[styles.panel, style]} elevated>
      <View style={styles.panelHeader}>
        <View style={[styles.panelIcon, { backgroundColor: theme.primarySoft }]}>
          <ProductIcon name="scan" size={18} color={theme.primary} />
        </View>
        <View style={styles.panelHeadingCopy}>
          <ProductText variant="bodyMedium">{title}</ProductText>
          <ProductText variant="caption" color={theme.textSecondary}>{subtitle}</ProductText>
        </View>
        <Pill tone="neutral">{pageRegions.length} {pageRegions.length === 1 ? 'part' : 'parts'}</Pill>
      </View>

      <WorksheetCanvas
        accessibilityLabel={accessibilityLabel}
        annotationLabel={annotationLabel}
        annotations={annotations}
        defaultSelectedRegionId={null}
        maxWidth={maxWidth}
        onAnnotationPress={onAnnotationPress}
        onRegionSelect={selectRegion}
        page={page}
        regions={regions}
        selectedRegionId={effectiveSelectedRegionId}
        showAnnotationLabels={showAnnotationLabels}
        showAnnotations={showAnnotations}
        showRegions={showRegions}
        style={canvasStyle}
        testID={testID ? `${testID}-canvas` : undefined}
      />

      {showRegionList && pageRegions.length > 0 ? (
        <View accessibilityLabel="Worksheet regions" accessibilityRole="radiogroup" style={styles.regionList}>
          {pageRegions.map((region, index) => {
            const isSelected = effectiveSelectedRegionId === region.id;
            const label = regionLabel(region, index);
            return (
              <Pressable
                key={region.id}
                accessibilityHint="Double tap to focus this part of the worksheet."
                accessibilityLabel={`Focus on ${label}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => selectRegion(region)}
                style={({ pressed }) => [
                  styles.regionRow,
                  {
                    backgroundColor: isSelected ? theme.primarySoft : theme.backgroundElement,
                    borderColor: isSelected ? theme.primary : theme.border,
                  },
                  pressed && styles.pressedRegionRow,
                ]}
              >
                <View style={[styles.regionDot, { backgroundColor: isSelected ? theme.primary : theme.border }]} />
                <View style={styles.regionCopy}>
                  <ProductText variant="caption">{label}</ProductText>
                  <ProductText variant="caption" color={theme.textSecondary} numberOfLines={1}>
                    {region.transcription ?? 'Part of your work'}
                  </ProductText>
                </View>
                {isSelected ? <ProductIcon name="check" size={15} color={theme.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Surface>
  );
}

function AnnotationOverlay({
  annotation,
  annotationIndex,
  annotationLabel,
  onPress,
  onRegionSelect,
  region,
  showLabel,
  theme,
}: {
  annotation: TutorAnnotation;
  annotationIndex: number;
  annotationLabel: WorksheetAnnotationLabel;
  onPress?: (annotation: TutorAnnotation) => void;
  onRegionSelect: (region: PageRegion) => void;
  region: PageRegion;
  showLabel: boolean;
  theme: ReturnType<typeof useTheme>;
}) {
  const label = annotationLabel(annotation);
  const targetStyle = normalizedBoundsToStyle(regionBounds(region));
  const palette = annotationPalette(annotation.kind, theme);
  const visual = (
    <>
      {annotation.kind === 'highlight' ? <View pointerEvents="none" style={[styles.annotationHighlight, { backgroundColor: palette.fill, borderColor: palette.border }]} /> : null}
      {annotation.kind === 'circle' ? <View pointerEvents="none" style={[styles.annotationCircle, { borderColor: palette.border }]} /> : null}
      {annotation.kind === 'underline' ? <View pointerEvents="none" style={[styles.annotationUnderline, { backgroundColor: palette.border }]} /> : null}
      {annotation.kind === 'arrow' ? <View pointerEvents="none" style={styles.annotationArrow}><Text aria-hidden style={[styles.annotationArrowGlyph, { color: palette.border }]}>↘</Text></View> : null}
      {annotation.kind === 'focus' ? <View pointerEvents="none" style={[styles.annotationFocus, { borderColor: palette.border, backgroundColor: palette.fill }]} /> : null}
      {(annotation.kind === 'label' || (showLabel && Boolean(annotation.label?.trim()))) ? (
        <View pointerEvents="none" style={[styles.annotationLabel, { backgroundColor: palette.border }]}>
          <Text numberOfLines={1} style={styles.annotationLabelText}>{label}</Text>
        </View>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityHint="Double tap to open this tutor annotation."
        onPress={() => {
          onRegionSelect(region);
          onPress(annotation);
        }}
        style={({ pressed }) => [
          targetStyle,
          styles.annotationHitArea,
          { zIndex: 20 + annotationIndex },
          pressed && styles.pressedAnnotation,
        ]}
      >
        {visual}
      </Pressable>
    );
  }

  return (
    <View
      accessible={Boolean(annotation.label)}
      accessibilityLabel={annotation.label ? label : undefined}
      accessibilityRole={annotation.label ? 'text' : undefined}
      pointerEvents="box-none"
      style={[targetStyle, styles.annotationHitArea, { zIndex: 20 + annotationIndex }]}
    >
      {visual}
    </View>
  );
}

function defaultRegionLabel(region: PageRegion, index: number): string {
  const title = region.kind.replace(/_/g, ' ');
  return `${title.charAt(0).toUpperCase()}${title.slice(1)} ${index + 1}`;
}

function defaultAnnotationLabel(annotation: TutorAnnotation): string {
  return annotation.label?.trim() || `${annotation.kind.charAt(0).toUpperCase()}${annotation.kind.slice(1)} annotation`;
}

function regionPalette(kind: PageRegion['kind'], theme: ReturnType<typeof useTheme>): { border: string; fill: string } {
  switch (kind) {
    case 'problem': return { border: theme.primary, fill: colorWithAlpha(theme.primary, 0.08) };
    case 'equation': return { border: theme.purpleText, fill: colorWithAlpha(theme.purpleText, 0.08) };
    case 'solution_step': return { border: theme.mintText, fill: colorWithAlpha(theme.mintText, 0.08) };
    case 'term': return { border: theme.peachText, fill: colorWithAlpha(theme.peachText, 0.08) };
    case 'diagram': return { border: theme.yellowText, fill: colorWithAlpha(theme.yellowText, 0.08) };
    case 'prose': return { border: theme.textSecondary, fill: colorWithAlpha(theme.textSecondary, 0.07) };
  }
}

function annotationPalette(kind: TutorAnnotation['kind'], theme: ReturnType<typeof useTheme>): { border: string; fill: string } {
  switch (kind) {
    case 'highlight': return { border: theme.yellowText, fill: colorWithAlpha(theme.yellow, HIGHLIGHT_FILL_ALPHA) };
    case 'circle': return { border: theme.peachText, fill: colorWithAlpha(theme.peach, CIRCLE_FILL_ALPHA) };
    case 'underline': return { border: theme.primary, fill: 'transparent' };
    case 'arrow': return { border: theme.primary, fill: 'transparent' };
    case 'focus': return { border: theme.purpleText, fill: colorWithAlpha(theme.purple, FOCUS_FILL_ALPHA) };
    case 'label': return { border: theme.primary, fill: 'transparent' };
  }
}

const styles = StyleSheet.create({
  canvas: {
    alignSelf: 'center',
    backgroundColor: '#F6F8FC',
    borderColor: '#E4E8F0',
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  image: {
    ...StyleSheet.absoluteFill,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  annotationLayer: {
    ...StyleSheet.absoluteFill,
    // Highlight washes stay below region hit targets and outlines.
    zIndex: 1,
  },
  foregroundAnnotationLayer: {
    // Circles, arrows, focus rings, and labels remain visible above regions.
    zIndex: 20,
  },
  regionLayer: {
    ...StyleSheet.absoluteFill,
    // Interaction and region outlines sit between the two annotation groups.
    zIndex: 10,
  },
  regionTarget: {
    borderRadius: 8,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  selectedRegionTarget: {
    borderWidth: 2.5,
    shadowColor: '#4668F2',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    zIndex: 1,
  },
  pressedRegionTarget: {
    opacity: 0.78,
  },
  annotationHitArea: {
    overflow: 'visible',
  },
  annotationHighlight: {
    ...StyleSheet.absoluteFill,
    borderRadius: 7,
    borderWidth: 1,
  },
  annotationCircle: {
    ...StyleSheet.absoluteFill,
    borderRadius: 9999,
    borderWidth: 3,
  },
  annotationUnderline: {
    borderRadius: 3,
    bottom: '4%',
    height: 3,
    left: '5%',
    position: 'absolute',
    right: '5%',
  },
  annotationArrow: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    left: '-8%',
    position: 'absolute',
    top: '-30%',
    width: 42,
  },
  annotationArrowGlyph: {
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  annotationFocus: {
    ...StyleSheet.absoluteFill,
    borderRadius: 10,
    borderWidth: 3,
  },
  annotationLabel: {
    borderRadius: 9,
    left: 4,
    maxWidth: 190,
    minHeight: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
    top: -14,
  },
  annotationLabelText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  pressedAnnotation: {
    opacity: 0.78,
  },
  panel: {
    alignSelf: 'center',
    gap: Spacing.three,
    maxWidth: 1200,
    width: '100%',
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  panelIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  panelHeadingCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  regionList: {
    gap: 7,
  },
  regionRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  regionDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  regionCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  pressedRegionRow: {
    opacity: 0.78,
  },
});
