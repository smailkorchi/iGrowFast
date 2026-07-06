export const theme = {
  colors: {
    ink: '#141413',
    canvas: '#faf9f5',
    muted: '#b0aea5',
    surface: '#e8e6dc',
    accentWarm: '#d97757',
    accentCool: '#6a9bcc',
    accentNatural: '#788c5d',
  },
  fonts: {
    heading: "'Poppins', Arial, sans-serif",
    body: "'Lora', Georgia, serif",
  },
} as const

export type Theme = typeof theme
