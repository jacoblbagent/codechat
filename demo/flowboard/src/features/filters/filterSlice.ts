import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { Priority } from '../board/types'
import type { RootState } from '../../app/store'

export interface Filters {
  query: string
  labelIds: string[]
  assignees: string[]
  priorities: Priority[]
  hideDone: boolean
}

const INITIAL: Filters = {
  query: '',
  labelIds: [],
  assignees: [],
  priorities: [],
  hideDone: false,
}

/** Toggle a value in an array without mutating it. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

const filterSlice = createSlice({
  name: 'filters',
  initialState: INITIAL,
  reducers: {
    queryChanged: (state, action: PayloadAction<string>) => {
      state.query = action.payload
    },
    labelToggled: (state, action: PayloadAction<string>) => {
      state.labelIds = toggle(state.labelIds, action.payload)
    },
    assigneeToggled: (state, action: PayloadAction<string>) => {
      state.assignees = toggle(state.assignees, action.payload)
    },
    priorityToggled: (state, action: PayloadAction<Priority>) => {
      state.priorities = toggle(state.priorities, action.payload)
    },
    hideDoneToggled: (state) => {
      state.hideDone = !state.hideDone
    },
    filtersCleared: () => INITIAL,
  },
})

export const {
  assigneeToggled,
  filtersCleared,
  hideDoneToggled,
  labelToggled,
  priorityToggled,
  queryChanged,
} = filterSlice.actions

export const selectFilters = (state: RootState): Filters => state.filters

/** True when anything is narrowing the board — drives the "clear" affordance. */
export const selectIsFiltered = (state: RootState): boolean => {
  const filters = state.filters
  return (
    filters.query !== '' ||
    filters.labelIds.length > 0 ||
    filters.assignees.length > 0 ||
    filters.priorities.length > 0 ||
    filters.hideDone
  )
}

export default filterSlice.reducer
