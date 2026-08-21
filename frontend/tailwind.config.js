/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
        },
        primary: {
          DEFAULT: "#00685f",
          container: "#008378",
          hover: "#005049",
        },
        "on-primary": "#ffffff",
        "on-primary-container": "#f4fffc",
        "on-primary-fixed-variant": "#005049",
        secondary: {
          DEFAULT: "#006780",
          container: "#76dcff",
        },
        "on-secondary-container": "#006077",
        "secondary-fixed": "#b7eaff",
        background: "#f7f9fb",
        surface: {
          DEFAULT: "#ffffff",
          "container-lowest": "#ffffff",
          "container-low": "#f2f4f6",
          container: "#eceef0",
          "container-high": "#e6e8ea",
          variant: "#e0e3e5",
        },
        "on-surface": "#191c1e",
        "on-surface-variant": "#3d4947",
        outline: "#6d7a77",
        "outline-variant": "#bcc9c6",
        error: {
          DEFAULT: "#ba1a1a",
          container: "#ffdad6",
        },
        tertiary: {
          DEFAULT: "#515c71",
          fixed: "#d8e3fb",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        manrope: ["Manrope", "sans-serif"],
      },
      boxShadow: {
        card: "0 4px 6px -1px rgba(30, 41, 59, 0.05), 0 2px 4px -2px rgba(30, 41, 59, 0.05)",
        modal: "0 20px 25px -5px rgba(30, 41, 59, 0.1), 0 8px 10px -6px rgba(30, 41, 59, 0.05)",
      },
    },
  },
  plugins: [],
};
