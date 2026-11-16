import { createContext, useContext } from 'react'
import logo from '../../build/icon.svg'

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
        <button onClick={a.home}>Cartella di base</button>
        <button onClick={a.pick}>Scegli cartella…</button>
        <button onClick={a.ssh}>Server SSH…</button>
      </div>
      <p className="welcome-hint">
        {mac ? 'Cmd' : 'Ctrl+Shift'}+T nuovo tab · {mac ? 'Cmd' : 'Ctrl+Shift'}+P vai a un file · {mac ? 'Cmd+Shift+P' : 'Ctrl+Shift+P, poi >'} tutti i comandi
      </p>
    </div>
  )
}
