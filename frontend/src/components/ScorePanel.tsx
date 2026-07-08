import { useEffect, useRef, useState } from 'react'
import { getScore, scoreMidiUrl } from '../api'

interface Props {
  jobId: string
  stem: string
  onClose: () => void
}

/** Auto-transcribed sheet music for one stem, rendered with OSMD. */
export default function ScorePanel({ jobId, stem, onClose }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const xmlRef = useRef<string | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        // poll while the backend transcribes (a few seconds per stem)
        let res = await getScore(jobId, stem)
        while (res.status === 'pending' && !cancelled) {
          await new Promise((r) => setTimeout(r, 1500))
          res = await getScore(jobId, stem)
        }
        if (cancelled) return
        if (res.status !== 'done' || !res.musicxml) {
          setError(res.error ?? 'transcription failed')
          setState('error')
          return
        }
        xmlRef.current = res.musicxml
        // OSMD is ~1MB, so it loads lazily as its own chunk
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay')
        if (cancelled || !sheetRef.current) return
        const osmd = new OpenSheetMusicDisplay(sheetRef.current, {
          autoResize: true,
          drawTitle: false,
          drawPartNames: false,
        })
        await osmd.load(res.musicxml)
        osmd.render()
        setState('ready')
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setState('error')
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [jobId, stem])

  const downloadXml = () => {
    if (!xmlRef.current) return
    const url = URL.createObjectURL(new Blob([xmlRef.current], { type: 'application/xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${stem}.musicxml`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadPdf = async () => {
    if (!xmlRef.current || pdfBusy) return
    setPdfBusy(true)
    // render an A4-paginated copy off-screen, then convert each SVG page
    // into a PDF page (same approach as OSMD's official pdf demo)
    const holder = document.createElement('div')
    holder.style.cssText = 'position:absolute;left:-100000px;top:0;width:794px;background:#fff'
    document.body.appendChild(holder)
    try {
      const [{ OpenSheetMusicDisplay }, { jsPDF }] = await Promise.all([
        import('opensheetmusicdisplay'),
        import('jspdf'),
      ])
      await import('svg2pdf.js') // adds .svg() to jsPDF
      const osmd = new OpenSheetMusicDisplay(holder, {
        autoResize: false,
        drawTitle: true,
        drawSubtitle: false,
        drawPartNames: false,
        pageFormat: 'A4_P',
        pageBackgroundColor: '#FFFFFF',
      })
      await osmd.load(xmlRef.current)
      osmd.render()
      const pages = Array.from(holder.querySelectorAll('svg'))
      if (pages.length === 0) throw new Error('nothing rendered')
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage()
        await pdf.svg(pages[i], { x: 0, y: 0, width: 210, height: 297 })
      }
      pdf.save(`${stem}.pdf`)
    } catch (e) {
      setError(String(e))
      setState('error')
    } finally {
      holder.remove()
      setPdfBusy(false)
    }
  }

  return (
    <div className="score-panel">
      <div className="score-header">
        <span className="score-title">
          ♪ {stem} — auto-transcribed{' '}
          <span className="score-note">(approximate: quantized to 16ths)</span>
        </span>
        {state === 'ready' && (
          <>
            <button className="chip" onClick={downloadPdf} disabled={pdfBusy}>
              {pdfBusy ? 'rendering…' : '⬇ pdf'}
            </button>
            <a className="chip" href={scoreMidiUrl(jobId, stem)} download={`${stem}.mid`}>
              ⬇ midi
            </a>
            <button className="chip" onClick={downloadXml}>
              ⬇ musicxml
            </button>
          </>
        )}
        <button className="chip" onClick={onClose}>
          ✕ close
        </button>
      </div>
      {state === 'loading' && (
        <div className="score-loading">
          <div className="spinner" />
          <div>Transcribing {stem}…</div>
        </div>
      )}
      {state === 'error' && <div className="error">⚠ {error}</div>}
      {/* keep the container laid out while loading: OSMD measures its width at render time */}
      <div
        ref={sheetRef}
        className="score-sheet"
        style={state === 'ready' ? undefined : { height: 0, padding: 0, overflow: 'hidden' }}
      />
    </div>
  )
}
