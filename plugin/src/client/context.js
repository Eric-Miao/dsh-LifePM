import { createContext, useContext } from 'react'

/** Shared dashboard state and actions for every view. */
export const LifePMContext = createContext(null)

/** Read the dashboard context; every view renders under `<App>`. */
export function usePM() {
  const value = useContext(LifePMContext)
  if (value === null) throw new Error('LifePM view rendered outside its provider')
  return value
}
