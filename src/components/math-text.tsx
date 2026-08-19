'use no memo';

import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
// @ts-expect-error -- no type declarations for the internal texToSvg named export
import { texToSvg } from 'react-native-mathjax-svg';

import { ProductText } from '@/components/product-primitives';

type Segment =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; display: boolean };

const MATH_PATTERN = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;

function splitSegments(source: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  MATH_PATTERN.lastIndex = 0;
  while ((match = MATH_PATTERN.exec(source))) {
    if (match.index > cursor) segments.push({ type: 'text', value: source.slice(cursor, match.index) });
    if (match[1] !== undefined) segments.push({ type: 'math', value: match[1].trim(), display: true });
    else if (match[2] !== undefined) segments.push({ type: 'math', value: match[2].trim(), display: false });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) segments.push({ type: 'text', value: source.slice(cursor) });
  return segments;
}

type MathSvg = { xml: string; width: number; height: number };

/**
 * MathJax's SVG output carries two problems for react-native-svg:
 * 1. `data-mml-node`/`data-c` semantic annotations get camelCased by the XML
 *    parser into invalid DOM prop names (`dataMmlNode`) that React rejects on web.
 * 2. Its width/height attributes are in CSS `ex` units (e.g. `width="85.1ex"`),
 *    which the browser renders relative to inherited font metrics rather than
 *    our chat text size, producing wildly oversized equations.
 * We strip both and convert the ex-unit values to pixels ourselves, using the
 * standard CSS approximation 1ex = 0.5em. Applying one fixed ex-to-px ratio
 * (rather than normalizing every formula to the same pixel height) preserves
 * MathJax's own relative proportions — a two-line fraction is legitimately
 * taller than a single digit at the same font size, and should render that way.
 */
function renderMathSvg(latex: string, color: string, fontSizePx: number): MathSvg | null {
  try {
    const raw: string = texToSvg(latex, 1);
    if (!raw) return null;
    const widthMatch = raw.match(/width="([\d.]+)[ep]x"/);
    const heightMatch = raw.match(/height="([\d.]+)[ep]x"/);
    const rawWidthEx = widthMatch ? parseFloat(widthMatch[1]) : 1;
    const rawHeightEx = heightMatch ? parseFloat(heightMatch[1]) : 1;
    const pxPerEx = fontSizePx * 0.5;
    const xml = raw
      .replace(/currentColor/gi, color)
      .replace(/\s(?:data|aria)-[a-zA-Z-]+="[^"]*"/g, '');
    return { xml, width: Math.round(rawWidthEx * pxPerEx), height: Math.round(rawHeightEx * pxPerEx) };
  } catch {
    return null;
  }
}

/** Renders chat message text, treating $inline$ and $$block$$ spans as LaTeX. */
export function MathText({ text, color, fontSize = 14 }: { text: string; color: string; fontSize?: number }) {
  const segments = splitSegments(text);
  const lineHeight = Math.round(fontSize * 1.5);

  return (
    <View style={styles.wrap}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          if (!segment.value) return null;
          return (
            <ProductText key={index} variant="body" color={color} style={{ fontSize, lineHeight }}>
              {segment.value}
            </ProductText>
          );
        }
        if (!segment.value) return null;
        const svg = renderMathSvg(segment.value, color, segment.display ? fontSize * 1.15 : fontSize);
        if (!svg) {
          return (
            <ProductText key={index} variant="body" color={color} style={{ fontSize, lineHeight }}>
              {segment.display ? `$$${segment.value}$$` : `$${segment.value}$`}
            </ProductText>
          );
        }
        return (
          <View
            key={index}
            style={
              segment.display
                ? styles.blockMath
                : [styles.inlineMath, { height: Math.max(lineHeight, svg.height) }]
            }
          >
            <SvgXml xml={svg.xml} width={svg.width} height={svg.height} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  inlineMath: { justifyContent: 'center', marginHorizontal: 2 },
  blockMath: { width: '100%', paddingVertical: 6, alignItems: 'center' },
});
