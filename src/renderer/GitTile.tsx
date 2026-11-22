import type { IDockviewPanelProps } from 'dockview-react'
import type { GitParams } from '../shared/types'
import { t } from '../shared/i18n'
import { setModule, useModule } from './modules'

// a repository in its own tab (placeholder until the Git view lands)
export default function GitTile({ params }: IDockviewPanelProps<GitParams>) {
  const on = useModule('git')
  if (!on)
    return (
      <div className="files-empty">
        {t('Lo scomparto Git è disattivato')} <button onClick={() => setModule('git', true)}>{t('Attiva')}</button>
      </div>
    )
  return <div className="files-empty">{params.cwd}</div>
}
