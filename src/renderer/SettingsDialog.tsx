import type { Settings } from '../shared/types'

// applied while you change them, saved with the app state
export default function SettingsDialog({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const set = (o: Partial<Settings>) => onChange({ ...settings, ...o })
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog settings" onKeyDown={e => e.key === 'Escape' && onClose()}>
        <h3>Impostazioni</h3>
        <label>Tema</label>
        <div className="row">
          {(['dark', 'light', 'system'] as const).map(t => (
            <button key={t} className={settings.theme === t ? 'primary' : ''} onClick={() => set({ theme: t })} autoFocus={settings.theme === t}>
              {t === 'dark' ? 'Scuro' : t === 'light' ? 'Chiaro' : 'Come il sistema'}
            </button>
          ))}
        </div>
        <label>Cartella di base (nuovi tab e pulsante Home)</label>
        <div className="row">
          <span className="path" title={settings.filesHome}>{settings.filesHome ?? 'Home utente'}</span>
          <button onClick={() => window.api.pickFolder(settings.filesHome).then(p => p && set({ filesHome: p }))}>Scegli…</button>
          {settings.filesHome && <button onClick={() => set({ filesHome: undefined })}>Ripristina</button>}
        </div>
        <div className="actions">
          <button className="primary" onClick={onClose}>
            Fatto
          </button>
        </div>
      </div>
    </div>
  )
}
