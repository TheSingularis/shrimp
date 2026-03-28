/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
      },
      colors: {
        // New blue/purple theme
        'blue-primary': '#5B7FFF',
        'blue-hover': '#4A6EEE',
        'purple-accent': '#8B7FFF',
        'blue-dim': '#1E2337',
        'bg-dark': '#0D0F17',
        'bg-elevated': '#161925',
        'border': '#252838',
        'text': '#E8EAF0',
        'text-muted': '#8891A8',

        // Legacy shrimp theme (updated to blue colors for compatibility)
        'shrimp': {
          bg: '#0D0F17',
          surface: '#161925',
          border: '#252838',
          text: '#E8EAF0',
          'text-muted': '#8891A8',
          accent: '#5B7FFF',
          'accent-dim': '#1E2337',
        },
      },
    },
  },
  plugins: [],
}
