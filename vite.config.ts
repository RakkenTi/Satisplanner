import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base works identically on both custom domain (satisplanner.markmartinez.ca)
// and project path (rakkenti.github.io/Satisplanner/).
export default defineConfig({
  base: './',
  plugins: [react()],
});
