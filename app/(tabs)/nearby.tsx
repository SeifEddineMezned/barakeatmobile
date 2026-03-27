/**
 * nearby.tsx — Hidden tab (href: null) that redirects to the real map-view screen.
 * All map logic lives in /map-view.tsx to avoid duplication.
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function NearbyRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/map-view' as never);
  }, [router]);
  return null;
}
