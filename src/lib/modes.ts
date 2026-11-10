export type Mode = 'news' | 'food'

export interface GlobeColors {
  /** Country without data. */
  default: string
  /** Country with data. */
  available: string
  hover: string
  selected: string
  side: string
  // WebGL lines are always 1px wide, so borders rely on contrast to be visible.
  stroke: string
}

interface ModeConfig {
  /** The italic word in the logo: "Wassup news?" / "Wassup food?". */
  label: string
  loadingText: string
  /** Files in public/. */
  mark: string
  favicon: string
  /** Opaque on purpose: transparent meshes must be depth-sorted every frame. */
  globe: GlobeColors
}

export const MODES: Record<Mode, ModeConfig> = {
  news: {
    label: 'news',
    loadingText: "Gathering today's front pages…",
    mark: 'logo-mark.svg',
    favicon: 'favicon.svg',
    globe: {
      default: '#262d38',
      available: '#2c5580',
      hover: '#d9a13f',
      selected: '#ffaa28',
      side: '#0f1520',
      stroke: '#a9c3e6',
    },
  },
  food: {
    label: 'food',
    loadingText: 'Heating up the kitchen…',
    mark: 'logo-mark-food.svg',
    favicon: 'favicon-food.svg',
    globe: {
      default: '#2e2824',
      available: '#86492d',
      // Selection is basil green, the complement of terracotta and distinct
      // from the news amber (keep in sync with --accent in index.css); hover
      // is a muted version of it, as in news.
      hover: '#6fae4a',
      selected: '#8bd45e',
      side: '#1a120d',
      stroke: '#f0cfa9',
    },
  },
}

export const otherMode = (mode: Mode): Mode => (mode === 'news' ? 'food' : 'news')
