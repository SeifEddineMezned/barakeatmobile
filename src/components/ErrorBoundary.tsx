import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import i18n from '@/src/i18n';
import { captureException } from '@/src/lib/sentry';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** Bumped on every recovery so the subtree fully remounts instead of
   *  re-rendering the same broken element tree (which would re-throw and loop). */
  resetKey: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, resetKey: 0 };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info);
    captureException(error, { componentStack: info.componentStack ?? '' });
  }

  // Leave the (possibly broken) current screen for a known-good one, THEN clear
  // the error and remount the subtree. Navigating first means that even if the
  // crash was the screen itself, "Retry" lands somewhere that renders instead
  // of re-throwing immediately — the previous implementation only flipped
  // hasError, so a deterministic render error looped forever.
  private handleRetry = () => {
    try {
      router.replace('/');
    } catch (e) {
      console.warn('[ErrorBoundary] navigation on retry failed:', e);
    }
    this.setState((prev) => ({ hasError: false, error: null, resetKey: prev.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <BarakeatErrorIcon size={56} color="#d94f4f" />
            <Text style={styles.title}>{i18n.t('common.errorOccurred')}</Text>
            <Text style={styles.subtitle}>
              {i18n.t('common.errorOccurredDesc', { defaultValue: 'An unexpected error occurred. Please try again.' })}
            </Text>
            <TouchableOpacity
              style={styles.button}
              onPress={this.handleRetry}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{i18n.t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f9f6',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
    width: '100%',
    maxWidth: 360,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#114b3c',
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: 'Poppins_700Bold',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b6b6b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    fontFamily: 'Poppins_400Regular',
  },
  button: {
    backgroundColor: '#114b3c',
    borderRadius: 9999,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  buttonText: {
    color: '#e3ff5c',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Poppins_600SemiBold',
    letterSpacing: 0.3,
  },
});
