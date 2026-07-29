import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#07080a',
        panel: '#0f1115',
        elevated: '#161922',
        line: 'rgba(255,255,255,0.08)',
        accent: '#4d9fff',
        accent2: '#7be8cf',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
