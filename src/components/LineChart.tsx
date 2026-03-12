import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useTheme } from '@/src/theme/ThemeProvider';

interface LineChartProps {
  data: number[];
  labels: string[];
  color: string;
  gradientColor?: string;
  width?: number;
  height?: number;
}

export function LineChart({ data, labels, color, gradientColor, width = 280, height = 140 }: LineChartProps) {
  const theme = useTheme();
  const padding = { top: 16, right: 12, bottom: 24, left: 12 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((val, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * chartW,
    y: padding.top + chartH - ((val - min) / range) * chartH,
  }));

  let linePath = '';
  if (points.length > 1) {
    linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
      const cpx2 = curr.x - (curr.x - prev.x) * 0.4;
      linePath += ` C ${cpx1} ${prev.y} ${cpx2} ${curr.y} ${curr.x} ${curr.y}`;
    }
  }

  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const areaPath = linePath
    + ` L ${lastPoint.x} ${height - padding.bottom}`
    + ` L ${firstPoint.x} ${height - padding.bottom} Z`;

  const grad = gradientColor ?? color;

  return (
    <View style={[styles.container, { width, height: height + 4 }]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={grad} stopOpacity="0.25" />
            <Stop offset="1" stopColor={grad} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>

        {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
          const y = padding.top + chartH * (1 - frac);
          return (
            <React.Fragment key={i}>
              <Rect x={padding.left} y={y} width={chartW} height={0.5} fill={theme.colors.divider} />
            </React.Fragment>
          );
        })}

        <Path d={areaPath} fill="url(#areaGrad)" />
        <Path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {points.map((pt, i) => (
          <Circle key={i} cx={pt.x} cy={pt.y} r={3.5} fill="#fff" stroke={color} strokeWidth={2} />
        ))}
      </Svg>

      <View style={[styles.labelsRow, { paddingLeft: padding.left, paddingRight: padding.right }]}>
        {labels.map((label, i) => (
          <Text key={i} style={[styles.label, { color: theme.colors.muted, fontFamily: 'Poppins_400Regular' }]}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  label: {
    fontSize: 10,
    textAlign: 'center' as const,
  },
});
