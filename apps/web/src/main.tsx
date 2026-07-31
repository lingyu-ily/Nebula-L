import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from './router.js'
import './i18n.js'
import './styles.css'
import { App } from './App.js'

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
                <App />
            </BrowserRouter>
        </QueryClientProvider>
    </StrictMode>
)
