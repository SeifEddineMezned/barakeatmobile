import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, Modal } from 'react-native';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
// 5-minute increments + 59 for common "end of hour" use case
const MINUTES = [...Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')), '59'];
const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;

// Repeat data 3× so scrolling wraps seamlessly (start in the middle copy)
const REPEAT = 3;
function makeLoopedData(src: string[]) {
  const items: { label: string; realIndex: number }[] = [];
  for (let r = 0; r < REPEAT; r++) {
    for (let i = 0; i < src.length; i++) {
      items.push({ label: src[i], realIndex: i });
    }
  }
  return items;
}
const LOOPED_HOURS = makeLoopedData(HOURS);
const LOOPED_MINUTES = makeLoopedData(MINUTES);

interface TimePickerProps {
  value: string; // "HH:MM"
  onChange: (value: string) => void;
  label?: string;
  primaryColor?: string;
  textColor?: string;
  bgColor?: string;
  mutedColor?: string;
}

function WheelColumn({ data, srcLength, initialIndex, onSelect, primaryColor, mutedColor }: {
  data: { label: string; realIndex: number }[];
  srcLength: number;
  initialIndex: number; // index into the SOURCE array (0..srcLength-1)
  onSelect: (realIndex: number) => void;
  primaryColor: string;
  mutedColor: string;
}) {
  const flatListRef = useRef<FlatList>(null);
  const [selectedReal, setSelectedReal] = useState(initialIndex);
  const mounted = useRef(false);
  const isScrolling = useRef(false);

  // Start position: middle copy of the data
  const middleOffset = srcLength; // index into looped array for middle copy
  const startIdx = middleOffset + initialIndex;

  const handleScrollEnd = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(data.length - 1, idx));
    const realIdx = data[clamped].realIndex;
    setSelectedReal(realIdx);
    onSelect(realIdx);

    // If scrolled near the edges, silently recenter to the middle copy
    if (clamped < srcLength / 2 || clamped >= srcLength * 2 + srcLength / 2) {
      const centeredIdx = middleOffset + realIdx;
      isScrolling.current = true;
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: centeredIdx * ITEM_HEIGHT, animated: false });
        isScrolling.current = false;
      }, 50);
    }
  }, [data, srcLength, middleOffset, onSelect]);

  // After mount, scroll to the correct position in the middle copy
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      const offset = startIdx * ITEM_HEIGHT;
      const t1 = setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset, animated: false });
      }, 50);
      const t2 = setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset, animated: false });
      }, 150);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, []);

  return (
    <View style={{ height: ITEM_HEIGHT * VISIBLE_ITEMS, width: 70, overflow: 'hidden' }}>
      <FlatList
        ref={flatListRef}
        data={data}
        keyExtractor={(_, index) => String(index)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
        onMomentumScrollEnd={handleScrollEnd}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
        renderItem={({ item, index }) => {
          const isSelected = item.realIndex === selectedReal;
          return (
            <TouchableOpacity
              onPress={() => {
                setSelectedReal(item.realIndex);
                onSelect(item.realIndex);
                flatListRef.current?.scrollToIndex({ index, animated: true });
              }}
              style={{ height: ITEM_HEIGHT, justifyContent: 'center', alignItems: 'center' }}
            >
              <Text style={{
                fontSize: isSelected ? 24 : 16,
                fontWeight: isSelected ? '700' : '400',
                color: isSelected ? primaryColor : mutedColor,
              }}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
      {/* Selection indicator */}
      <View pointerEvents="none" style={{
        position: 'absolute', top: ITEM_HEIGHT * 2, left: 0, right: 0, height: ITEM_HEIGHT,
        borderTopWidth: 1, borderBottomWidth: 1, borderColor: primaryColor + '30',
      }} />
    </View>
  );
}

function parseValue(value: string): { h: string; m: string; hIdx: number; mIdx: number } {
  const parts = (value || '').split(':');
  const h = (parts[0] ?? '').substring(0, 2).padStart(2, '0');
  const rawM = parseInt(parts[1] ?? '0', 10);
  let m: string;
  if (rawM === 59) {
    m = '59';
  } else {
    const rounded = Math.round(rawM / 5) * 5;
    m = String(rounded >= 60 ? 55 : rounded).padStart(2, '0');
  }
  return {
    h,
    m,
    hIdx: Math.max(0, HOURS.indexOf(h)),
    mIdx: Math.max(0, MINUTES.indexOf(m)),
  };
}

export function TimePicker({ value, onChange, label, primaryColor = '#114b3c', textColor = '#1a1a1a', bgColor = '#fff', mutedColor = '#999' }: TimePickerProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const selectedH = useRef(0);
  const selectedM = useRef(0);
  const [openCount, setOpenCount] = useState(0);

  const parsed = parseValue(value);

  const openPicker = () => {
    selectedH.current = parsed.hIdx;
    selectedM.current = parsed.mIdx;
    setOpenCount(c => c + 1);
    setModalVisible(true);
  };

  const confirm = () => {
    onChange(`${HOURS[selectedH.current]}:${MINUTES[selectedM.current]}`);
    setModalVisible(false);
  };

  return (
    <>
      <TouchableOpacity onPress={openPicker} style={{ backgroundColor: bgColor, borderRadius: 12, borderWidth: 1, borderColor: primaryColor + '30', paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: textColor, fontSize: 20, fontWeight: '700', letterSpacing: 1 }}>
          {value ? `${parsed.h}:${parsed.m}` : '--:--'}
        </Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: bgColor, borderRadius: 24, padding: 24, width: '100%', maxWidth: 320, alignItems: 'center' }} onStartShouldSetResponder={() => true}>
            {label && (
              <Text style={{ color: textColor, fontSize: 16, fontWeight: '700', marginBottom: 16 }}>
                {label}
              </Text>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <WheelColumn
                key={`h-${openCount}`}
                data={LOOPED_HOURS}
                srcLength={HOURS.length}
                initialIndex={parsed.hIdx}
                onSelect={(idx) => { selectedH.current = idx; }}
                primaryColor={primaryColor}
                mutedColor={mutedColor}
              />
              <Text style={{ fontSize: 28, fontWeight: '700', color: primaryColor, marginHorizontal: 8 }}>:</Text>
              <WheelColumn
                key={`m-${openCount}`}
                data={LOOPED_MINUTES}
                srcLength={MINUTES.length}
                initialIndex={parsed.mIdx}
                onSelect={(idx) => { selectedM.current = idx; }}
                primaryColor={primaryColor}
                mutedColor={mutedColor}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: primaryColor + '30', alignItems: 'center' }}>
                <Text style={{ color: mutedColor, fontSize: 14, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirm} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: primaryColor, alignItems: 'center' }}>
                <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700' }}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
