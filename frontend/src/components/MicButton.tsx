import { useVoice } from '../hooks/useVoice'

interface Props {
  onTranscript: (text: string, isFinal: boolean) => void
  size?: 'sm' | 'md'
  className?: string
  title?: string
}

export default function MicButton({
  onTranscript,
  size = 'sm',
  className,
  title,
}: Props) {
  const voice = useVoice(onTranscript)

  if (!voice.supported) return null

  const dim = size === 'md' ? 'h-9 w-9' : 'h-7 w-7'
  const icon = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'

  return (
    <button
      type="button"
      onClick={() => (voice.listening ? voice.stop() : voice.start())}
      title={title || (voice.listening ? 'Stop listening' : 'Voice input')}
      className={
        `grid ${dim} place-items-center rounded-lg border transition ` +
        (voice.listening
          ? 'border-rose-500/40 bg-rose-500/15 text-rose-300 animate-pulse-soft shadow-lg shadow-rose-500/10'
          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white') +
        ' ' +
        (className || '')
      }
      aria-label={voice.listening ? 'Stop voice input' : 'Start voice input'}
    >
      {voice.listening ? (
        <svg viewBox="0 0 24 24" fill="none" className={icon}>
          <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" className={icon}>
          <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  )
}
