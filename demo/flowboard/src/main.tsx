import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import App from './App'
import { store } from './app/store'
import { loadBoard } from './features/board/boardSlice'
import { available } from './lib/storage'
import './styles/tokens.css'
import './styles/global.css'

// Rehydrate before the first paint so the board never flashes the empty seed.
store.dispatch(loadBoard())

const container = document.getElementById('root')
if (!container) throw new Error('Flowboard needs a #root element to mount into.')

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
)

if (!available()) {
  console.warn('Local storage is unavailable, so this board will not survive a reload.')
}
