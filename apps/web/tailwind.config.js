/** REPAIRVERSE design tokens. Colours are CSS variables (see src/index.css) so themes stay consistent. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), muted: v('ink-muted'), faint: v('ink-faint') },
        paper: { DEFAULT: v('paper'), raised: v('paper-raised'), sunken: v('paper-sunken') },
        line: v('line'),
        accent: { DEFAULT: v('accent'), soft: v('accent-soft'), ink: v('accent-ink') },
        signal: { DEFAULT: v('signal'), soft: v('signal-soft') },
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
        warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem', '3xl': '1.75rem' },
      boxShadow: {
        soft: '0 1px 2px rgb(15 17 22 / 0.04), 0 8px 24px -12px rgb(15 17 22 / 0.12)',
        lift: '0 2px 4px rgb(15 17 22 / 0.04), 0 24px 48px -24px rgb(15 17 22 / 0.25)',
      },
      keyframes: {
        'fade-up': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        pulseRing: { '0%': { transform: 'scale(.9)', opacity: 0.6 }, '100%': { transform: 'scale(1.35)', opacity: 0 } },
      },
      animation: { 'fade-up': 'fade-up .35s ease-out both', ring: 'pulseRing 2.4s ease-out infinite' },
    },
  },
  plugins: [],
};
