import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

  return {
    plugins: [
      tailwindcss(),
      react(),
    ],
    // build config removed for typing fix
    server: supabaseUrl && supabaseAnonKey
      ? {
          proxy: {
            '/__sbfn': {
              target: `${supabaseUrl}/functions/v1`,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/__sbfn/, ''),
              headers: {
                apikey: supabaseAnonKey,
              },
            },
          },
        }
      : undefined,
  };
})

