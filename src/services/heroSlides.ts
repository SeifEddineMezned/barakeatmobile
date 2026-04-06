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
  /** Image width in px (default 80). Height = size * 1.36 */
  image_size?: number;
  /** Text vertical alignment: 'top' | 'center' | 'bottom' */
  text_align_v?: string;
  /** Title font size in px (default 18) */
  title_font_size?: number;
  /** Subtitle text opacity 0–1 (default 0.7) */
  subtitle_opacity?: number;
  /** Image opacity 0–1 (default 1.0) */
  image_opacity?: number;
  /** Vertical text nudge in px, negative = up (default 0) */
  text_offset_y?: number;
}

export async function fetchHeroSlides(): Promise<HeroSlide[]> {
  try {
    const res = await apiClient.get<HeroSlide[]>('/api/hero-slides');
    return res.data ?? [];
  } catch {
    return [];
  }
}
