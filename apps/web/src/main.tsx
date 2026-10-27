import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from './router.js'
import './i18n.js'
import './styles.css'
import { App } from './App.js'
import { MotionProvider } from './visual/motion.js'
import { NebulaBackground } from './visual/NebulaBackground.js'
import './console.css'

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { staleTime: 10_000, retry: 1 },
        mutations: { retry: 0 }
    }
})

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                <MotionProvider>
                    <NebulaBackground />
                    <App />
                </MotionProvider>
            </BrowserRouter>
        </QueryClientProvider>
    </StrictMode>
)
