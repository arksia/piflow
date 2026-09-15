import { useEffect, useRef } from 'react'
import styles from './styles.module.css'

interface ThinkingSurfaceProps { active?: boolean }
interface Dot { x: number, y: number, r: number, phase: number }
export default function ThinkingSurface({ active = true }: ThinkingSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; const context = canvas?.getContext('2d')
    if (!canvas || !context)
      return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0; let width = 0; let height = 0; let dots: Dot[] = []; let dpr = 1
    const shape = (x: number, y: number) => { const a = ((x + 0.03) / 0.47) ** 2 + ((y - 0.5) / 0.42) ** 2; const b = ((x - 0.03) / 0.47) ** 2 + ((y - 0.5) / 0.42) ** 2; return (a < 1 || b < 1) && !(Math.abs(x) < 0.055 && y > 0.16 && y < 0.85) }
    function resize() {
      const rect = canvas!.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); width = rect.width; height = rect.height; canvas!.width = Math.round(width * dpr); canvas!.height = Math.round(height * dpr); context!.setTransform(dpr, 0, 0, dpr, 0, 0); dots = []; for (let y = 0.1; y < 0.91; y += 0.035) {
        for (let x = -0.48; x <= 0.48; x += 0.035) {
          if (shape(x, y) && Math.random() > 0.16)
            dots.push({ x, y, r: 0.7 + Math.random() * 1.25, phase: Math.random() * Math.PI * 2 })
        }
      }
    }
    function draw(time: number) {
      const t = reduced.matches || !active ? 0 : time * 0.001; context!.clearRect(0, 0, width, height); context!.fillStyle = '#0d1112'; context!.fillRect(0, 0, width, height); const cx = width / 2; const cy = height / 2; const scale = Math.min(width, height) * 0.9; const px = (x: number) => cx + x * scale; const py = (y: number) => cy + (y - 0.5) * scale; context!.globalCompositeOperation = 'lighter'; for (const dot of dots) { const pulse = 0.45 + 0.55 * Math.sin(dot.phase + t * 2.2) ** 2; context!.fillStyle = `rgba(111,226,208,${0.22 + pulse * 0.48})`; context!.beginPath(); context!.arc(px(dot.x), py(dot.y), dot.r * (0.8 + pulse * 0.45), 0, Math.PI * 2); context!.fill() } for (let lane = 0; lane < 8; lane++) {
        const y = 0.22 + lane * 0.075; const progress = (t * (0.12 + lane * 0.009) + lane * 0.17) % 1; const x = -0.42 + progress * 0.84; const yy = y + Math.sin(progress * Math.PI * 2 + lane) * 0.035; if (!shape(x, yy))
          continue; const gx = context!.createRadialGradient(px(x), py(yy), 0, px(x), py(yy), 18); gx.addColorStop(0, 'rgba(255,196,120,.95)'); gx.addColorStop(0.22, 'rgba(255,135,103,.65)'); gx.addColorStop(1, 'rgba(255,100,88,0)'); context!.fillStyle = gx; context!.beginPath(); context!.arc(px(x), py(yy), 15, 0, Math.PI * 2); context!.fill(); context!.fillStyle = '#ffd9a1'; context!.beginPath(); context!.arc(px(x), py(yy), 2.2, 0, Math.PI * 2); context!.fill()
      } context!.globalCompositeOperation = 'source-over'; if (!reduced.matches && active)
        frame = requestAnimationFrame(draw)
    }
    resize(); draw(0); const observer = new ResizeObserver(resize); observer.observe(canvas); const onMotion = () => draw(0); reduced.addEventListener('change', onMotion); return () => { cancelAnimationFrame(frame); observer.disconnect(); reduced.removeEventListener('change', onMotion) }
  }, [active])
  return <div className={styles.surface} aria-hidden="true"><canvas ref={canvasRef} /></div>
}
