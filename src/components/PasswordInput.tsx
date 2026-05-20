import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, type TextInputProps, type ViewStyle } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

interface PasswordInputProps extends Omit<TextInputProps, 'secureTextEntry'> {
  containerStyle?: ViewStyle;
}

export function PasswordInput({ containerStyle, style, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#114b3c', borderRadius: 12, overflow: 'hidden' }, containerStyle]}>
      <TextInput
        {...rest}
        secureTextEntry={!visible}
        style={[{ flex: 1, height: 48, paddingHorizontal: 16 }, style]}
      />
      <TouchableOpacity
        onPress={() => setVisible((v) => !v)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={{ paddingHorizontal: 14 }}
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <Eye size={20} color="#114b3c" /> : <EyeOff size={20} color="#114b3c80" />}
      </TouchableOpacity>
    </View>
  );
}
