export const STEM_ORDER = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']

export const STEM_COLORS: Record<string, string> = {
  vocals: '#f472b6',
  drums: '#fbbf24',
  bass: '#60a5fa',
  guitar: '#fb923c',
  piano: '#a78bfa',
  other: '#34d399',
}

export const STEM_ICONS: Record<string, string> = {
  vocals: '🎤',
  drums: '🥁',
  bass: '🎸',
  guitar: '🎸',
  piano: '🎹',
  other: '🎶',
}

export const sortStems = (stems: string[]) =>
  [...stems].sort((a, b) => STEM_ORDER.indexOf(a) - STEM_ORDER.indexOf(b))
