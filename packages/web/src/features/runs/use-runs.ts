import { useEffect, useSyncExternalStore } from 'react'
import {
  getActivityVersion,
  getRunsVersion,
  loadRunWindow,
  runProject,
  runWindow,
  subscribeRuns,
} from './store'

export function useRunProject(projectPath: string, activityOnly = false) {
  useSyncExternalStore(
    subscribeRuns,
    activityOnly ? getActivityVersion : getRunsVersion,
    getRunsVersion,
  )
  useEffect(() => {
    if (!runWindow(projectPath).initialized)
      void loadRunWindow(projectPath)
  }, [projectPath])
  return runProject(projectPath)
}
