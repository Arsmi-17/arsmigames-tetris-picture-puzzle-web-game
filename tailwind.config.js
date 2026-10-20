/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sampled directly from Graphics-Fonts/Reference-UI
        brand: {
          blue: '#236DFF',
          'blue-dark': '#1B57CC',
          coral: '#FF4D40',
          'coral-dark': '#E63B2F',
          sky: '#D7E8F9',
          mist: '#F0F4F6',
          ink: '#000000',
          body: '#2B2E32',
          muted: '#5B6066',
        },
      },
      fontFamily: {
        sans: ['Tally', 'system-ui', 'sans-serif'],
        display: ['Tally Display', 'Tally', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 2px 10px rgba(21, 56, 112, 0.06)',
        cta: '0 10px 24px rgba(35, 109, 255, 0.28)',
      },
    },
  },
  plugins: [],
};
