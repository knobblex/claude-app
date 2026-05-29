/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // Sub-apps live as siblings of web-app/; scan their ui/ for Tailwind classes.
    "../app/*/ui/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', '"PingFang SC"', 'ui-sans-serif', 'sans-serif'],
        serif: ['"Source Serif 4"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Mobile design-spec values (see web-app/design/mockup-v1.html).
        // Names preserved from earlier "notion-*" so existing class usage doesn't
        // need to be rewritten. Values rebased to the spec: darker, more neutral.
        notion: {
          bg: '#ffffff',
          soft: '#fafaf9',
          hover: 'rgba(20,20,20,0.04)',
          active: 'rgba(20,20,20,0.08)',
          text: '#1a1a1a',
          text2: '#5a5a5a',
          text3: '#9a9a9a',
          border: 'rgba(20,20,20,0.07)',
          border2: 'rgba(20,20,20,0.14)',
          divider: 'rgba(20,20,20,0.05)',
          blue: '#2383e2',
          blueSoft: '#eaf3fb',
        },
        // Avatar / badge accent pairs for the no-bubble thread (屏 4).
        conv: { deep: '#2563eb', soft: '#ecf2fb' },
        user: { deep: '#c2410c', soft: '#fff5ec' },
        // Recording / polish states (composer 屏 8-11).
        rec: { red: '#dc2626', orange: '#ea580c', warm: '#fff1ec', warmBorder: '#f5c4b0' },
        polish: { greenBg: '#ecfdf5', greenBorder: '#86efac', greenText: '#14532d' },
      },
      keyframes: {
        pulseDot: {
          '0%,80%,100%': { opacity: '0.2' },
          '40%': { opacity: '1' },
        },
        slideIn: {
          from: { transform: 'translateX(8px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        pulseDot: 'pulseDot 1.4s infinite',
        slideIn: 'slideIn .18s ease-out',
      },
    },
  },
  plugins: [],
};
