/** @type {import('tailwindcss').Config} */
export default {
  // Purge : Tailwind ne garde que les classes réellement utilisées
  content: [
    './*.html',
    './src/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['Inter', 'sans-serif'],
        serif: ['Playfair Display', 'serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#d97706',
          light:   '#fbbf24',
          dark:    '#b45309',
        },
        villa: {
          stone: '#f5f0eb',
          warm:  '#fef3c7',
        },
      },
      animation: {
        'fade-in':  'fadeIn 0.6s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(20px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
}
