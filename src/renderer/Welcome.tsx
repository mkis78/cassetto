import { createContext, useContext } from 'react'
import logo from '../../build/icon.svg'
import { t } from '../shared/i18n'

export interface WelcomeActions {
  home: () => void
  pick: () => void
  ssh: () => void
}

// filled by App: dockview creates the watermark itself, so its actions come through context
export const WelcomeContext = createContext<WelcomeActions | null>(null)

// what the window shows with no tab open
export default function Welcome() {
  const a = useContext(WelcomeContext)
  if (!a) return null
  const mac = window.api.platform === 'darwin'
  return (
    <div className="welcome">
      <img className="welcome-logo" src={logo} alt="" />
      <h1>Cassetto</h1>
      <div className="welcome-others">
        <button onClick={a.home}>{t('Cartella di base')}</button>
        <button onClick={a.pick}>{t('Scegli cartella…')}</button>
        <button onClick={a.ssh}>{t('Server SSH…')}</button>
      </div>
      <p className="welcome-hint">
        {t('{tab} nuovo tab · {file} vai a un file · {all} tutti i comandi', { tab: mac ? 'Cmd+T' : 'Ctrl+Shift+T', file: mac ? 'Cmd+P' : 'Ctrl+Shift+P', all: mac ? 'Cmd+Shift+P' : t('Ctrl+Shift+P, poi >') })}
      </p>
    </div>
  )
}
