import { useEffect, useState } from 'react'
import type { Settings } from '../shared/types'
import { DEFAULT_BAR, fromEvent, shortcutLabel } from '../shared/shortcuts'

// press a combination to set it; Esc gives up. data-recording keeps the app's own shortcuts off it meanwhile
function ShortcutField({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [recording, setRecording] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.api.shortcutConflict(value).then(c => live && setConflict(c))
    return () => void (live = false)
  }, [value])
  return (
    <>
      <div className="row">
        <button
          className={'shortcut' + (recording ? ' recording' : '')}
          data-recording={recording || undefined}
          onClick={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={e => {
            if (!recording) return
            e.preventDefault()
            e.stopPropagation()
            if (e.key === 'Escape') return setRecording(false)
            const s = fromEvent(e)
            if (s) (onChange(s), setRecording(false))
          }}
        >
          {recording ? 'Premi la combinazione… (Esc annulla)' : shortcutLabel(value)}
        </button>
        {value !== DEFAULT_BAR && <button onClick={() => onChange(DEFAULT_BAR)}>Ripristina</button>}
      </div>
      {conflict && (
        <p className="shortcut-conflict">
          {shortcutLabel(value)} è già usata da «{conflict}»: macOS la intercetta e la barra non si apre. Scegline un'altra, oppure disattiva quella di sistema.
        </p>
      )}
    </>
  )
}

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
        <label>Scorciatoia della barra azioni</label>
        <ShortcutField value={settings.barShortcut ?? DEFAULT_BAR} onChange={barShortcut => set({ barShortcut })} />
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
