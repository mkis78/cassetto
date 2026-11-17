import { useEffect, useState } from 'react'
import type { Settings } from '../shared/types'
import { leaveAsking } from './tiles'
import { DEFAULT_BAR, fromEvent, shortcutLabel } from '../shared/shortcuts'
import { t, getLang, LANG_NAMES, resolveLang, type Lang, type LangSetting } from '../shared/i18n'

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
          {recording ? t('Premi la combinazione… (Esc annulla)') : shortcutLabel(value)}
        </button>
        {value !== DEFAULT_BAR && <button onClick={() => onChange(DEFAULT_BAR)}>{t('Ripristina')}</button>}
      </div>
      {conflict && (
        <p className="shortcut-conflict">
          {t("{keys} è già usata da «{what}»: macOS la intercetta e la barra non si apre. Scegline un'altra, oppure disattiva quella di sistema.", { keys: shortcutLabel(value), what: conflict })}
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
        <h3>{t('Impostazioni')}</h3>
        <label>{t('Lingua')}</label>
        <div className="row">
          <select value={settings.language ?? 'system'} onChange={e => set({ language: e.target.value as LangSetting })}>
            <option value="system">{t('Come il sistema')}</option>
            {(Object.keys(LANG_NAMES) as Lang[]).map(l => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
          {/* the language in use was set at start; a different choice waits for the next one */}
          {resolveLang(settings.language, navigator.language) !== getLang() && (
            <>
              <span className="path">{t('Si applica al riavvio')}</span>
              <button className="primary" onClick={() => leaveAsking() && void window.api.relaunch()}>
                {t('Riavvia ora')}
              </button>
            </>
          )}
        </div>
        <label>{t('Tema')}</label>
        <div className="row">
          {(['dark', 'light', 'system'] as const).map(th => (
            <button key={th} className={settings.theme === th ? 'primary' : ''} onClick={() => set({ theme: th })} autoFocus={settings.theme === th}>
              {th === 'dark' ? t('Scuro') : th === 'light' ? t('Chiaro') : t('Come il sistema')}
            </button>
          ))}
        </div>
        <label>{t('Scorciatoia della barra azioni')}</label>
        <ShortcutField value={settings.barShortcut ?? DEFAULT_BAR} onChange={barShortcut => set({ barShortcut })} />
        <label>{t('Cartella di base (nuovi tab e pulsante Home)')}</label>
        <div className="row">
          <span className="path" title={settings.filesHome}>{settings.filesHome ?? t('Home utente')}</span>
          <button onClick={() => window.api.pickFolder(settings.filesHome).then(p => p && set({ filesHome: p }))}>{t('Scegli…')}</button>
          {settings.filesHome && <button onClick={() => set({ filesHome: undefined })}>{t('Ripristina')}</button>}
        </div>
        <div className="actions">
          <button className="primary" onClick={onClose}>
            {t('Fatto')}
          </button>
        </div>
      </div>
    </div>
  )
}
