import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b1020',
        panel: '#131a2e',
        edge: '#233150',
        accent: '#4f8cff',
        profit: '#22c55e',
        loss: '#ef4444',
        warn: '#f59e0b',
        muted: '#8ea0c4',
      },
    },
  },
  plugins: [],
};

export default config;
