import { apiClient } from '@/src/lib/api';

export interface HeroSlide {
  id: number;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  bg_color?: string;
  text_color?: string;
  accent_color?: string;
  link_url?: string | null;
  sort_order: number;
}

export async function fetchHeroSlides(): Promise<HeroSlide[]> {
  try {
    const res = await apiClient.get<HeroSlide[]>('/api/hero-slides');
    return res.data ?? [];
  } catch {
    return [];
  }
}
