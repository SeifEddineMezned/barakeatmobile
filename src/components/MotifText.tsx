/**
 * MotifText — renders a cancellation motif that collapses to `collapsedLines`
 * with a trailing ellipsis when long, and expands / re-collapses on a "Voir
 * plus" / "Voir moins" toggle. A hidden, unclamped copy is laid out off-screen
 * purely to measure the TRUE line count (RN's onTextLayout clamps to
 * numberOfLines on Android, so we can't read it from the visible copy), which
 * is what decides whether the toggle is needed.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, type TextStyle } from 'react-native';

interface MotifTextProps {
  value: string;
  /** Optional bold prefix rendered inline (e.g. "Motif : "). */
  label?: string;
  textStyle: TextStyle;
  color: string;
  /** Color of the show-more / show-less toggle. */
  linkColor: string;
  align?: 'left' | 'right';
  collapsedLines?: number;
  t: (k: string, opts?: any) => string;
}

export function MotifText({
  value,
  label,
  textStyle,
  color,
  linkColor,
  align = 'left',
  collapsedLines = 2,
  t,
}: MotifTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const canToggle = lineCount > collapsedLines;

  const content = (
    <>
      {label ? <Text style={{ fontFamily: 'Poppins_600SemiBold', color }}>{label}</Text> : null}
      <Text style={{ color }}>{value}</Text>
    </>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Hidden measurer — unclamped, off-screen, only to count real lines. */}
      <Text
        style={[textStyle, { color, textAlign: align, position: 'absolute', left: 0, right: 0, opacity: 0 }]}
        onTextLayout={(e) => {
          const n = e.nativeEvent.lines.length;
          setLineCount((prev) => (prev === n ? prev : n));
        }}
        pointerEvents="none"
      >
        {content}
      </Text>

      <Text style={[textStyle, { color, textAlign: align }]} numberOfLines={expanded ? undefined : collapsedLines}>
        {content}
      </Text>

      {canToggle ? (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={{ alignSelf: align === 'right' ? 'flex-end' : 'flex-start', marginTop: 2 }}
        >
          <Text style={{ color: linkColor, fontFamily: 'Poppins_600SemiBold', fontSize: 11 }}>
            {expanded
              ? t('common.showLess', { defaultValue: 'Voir moins' })
              : t('common.showMore', { defaultValue: 'Voir plus' })}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
