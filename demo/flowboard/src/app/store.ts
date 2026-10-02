import { configureStore } from '@reduxjs/toolkit'
import boardReducer from '../features/board/boardSlice'
import filtersReducer from '../features/filters/filterSlice'
import { persistBoard } from './persist'

export const store = configureStore({
  reducer: {
    board: boardReducer,
    filters: filtersReducer,
  },
  middleware: (getDefault) => getDefault().concat(persistBoard.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
