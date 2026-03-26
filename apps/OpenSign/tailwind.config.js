/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {}
  },
  plugins: [
    require("daisyui"),
    function ({ addUtilities, addVariant }) {
      // ✅ Variants that match html[data-theme="..."] (or any ancestor with data-theme)
      addVariant("opensigncss", '[data-theme="opensigncss"] &');
      addVariant("opensigndark", '[data-theme="opensigndark"] &');

      addUtilities({
        // Prevent iOS long-press popup
        ".touch-callout-none": {
          "-webkit-touch-callout": "none"
        },
        // VS Code-style disabled button for all themes
        ".op-btn-vscode-disabled": {
          "background-color": "#3C3C3C !important",
          color: "#CCCCCC !important",
          "border-color": "#565656 !important",
          cursor: "not-allowed !important",
          opacity: "1 !important",
          "&:hover": {
            "background-color": "#3C3C3C !important",
            color: "#CCCCCC !important",
            "border-color": "#565656 !important",
            transform: "none !important"
          }
        },
        // Dark mode icon improvements using DaisyUI theme detection
        '[data-theme="opensigndark"] .icon-improved': {
          color: "#CCCCCC !important"
        },
        '[data-theme="opensigndark"] .icon-muted': {
          color: "#999999 !important"
        },
        '[data-theme="opensigndark"] .icon-disabled': {
          color: "#858585 !important"
        },
        // Gray text improvements for dark mode
        '[data-theme="opensigndark"] .text-gray-500': {
          color: "#CCCCCC !important"
        },
        '[data-theme="opensigndark"] .text-gray-400': {
          color: "#999999 !important"
        },
        '[data-theme="opensigndark"] .text-gray-600': {
          color: "#CCCCCC !important"
        },
        // CSS variable utilities that work with arbitrary values
        ".icon-themed": {
          color: "var(--icon-color)"
        },
        ".icon-themed-muted": {
          color: "var(--icon-color-muted)"
        },
        ".icon-themed-disabled": {
          color: "var(--icon-color-disabled)"
        },
        ".btn-themed-disabled": {
          "background-color": "var(--btn-disabled-bg)",
          color: "var(--btn-disabled-color)",
          "border-color": "var(--btn-disabled-border)",
          cursor: "not-allowed",
          "&:hover": {
            "background-color": "var(--btn-disabled-bg)",
            color: "var(--btn-disabled-color)",
            "border-color": "var(--btn-disabled-border)",
            transform: "none"
          }
        }
      });
    }
  ],
  daisyui: {
    // themes: true,
    themes: [
      {
        opensigndark: {
          primary: "#2563EB", // LeaseLynx blue-600
          "primary-content": "#FFFFFF",

          secondary: "#0F172A", // LeaseLynx slate-900
          "secondary-content": "#E2E8F0",

          accent: "#3B82F6", // LeaseLynx blue-500
          "accent-content": "#FFFFFF",

          neutral: "#334155", // slate-700
          "neutral-content": "#CBD5E1", // slate-300

          "base-100": "#020617", // LeaseLynx slate-950 (app bg)
          "base-200": "#0F172A", // slate-900
          "base-300": "#1E293B", // slate-800
          "base-content": "#F1F5F9", // slate-100

          info: "#2563EB",
          success: "#10B981", // emerald-500
          warning: "#F59E0B",
          error: "#EF4444",

          "--rounded-btn": "1.9rem",
          "--tab-border": "2px",
          "--tab-radius": "0.7rem",

          // Custom CSS variables for icon and button states
          "--icon-color": "#CCCCCC",
          "--icon-color-muted": "#999999",
          "--icon-color-disabled": "#858585",
          "--btn-disabled-bg": "#3C3C3C",
          "--btn-disabled-color": "#CCCCCC",
          "--btn-disabled-border": "#565656",

          // Optional polish
          "--navbar-padding": "0.8rem",
          "--border-color": "#2C2C2C", // Card/table separation
          "--tooltip-color": "#1F2937"
        }
      },
      {
        opensigncss: {
          primary: "#2563EB", // LeaseLynx blue-600
          "primary-content": "#FFFFFF",
          secondary: "#1E293B", // slate-800
          "secondary-content": "#E2E8F0",
          accent: "#10B981", // emerald-500
          "accent-content": "#FFFFFF",
          neutral: "#CBD5E1", // slate-300
          "neutral-content": "#0F172A",
          "base-100": "#F8FAFC", // slate-50
          "base-200": "#E2E8F0", // slate-200
          "base-300": "#CBD5E1", // slate-300
          "base-content": "#0F172A", // slate-900
          info: "#2563EB",
          "info-content": "#FFFFFF",
          success: "#10B981",
          "success-content": "#FFFFFF",
          warning: "#F59E0B",
          "warning-content": "#0F172A",
          error: "#EF4444",
          "error-content": "#FFFFFF",
          "--rounded-btn": "1.9rem",
          "--tab-border": "2px",
          "--tab-radius": "0.7rem"
        }
      }
    ],
    prefix: "op-"
  }
};
