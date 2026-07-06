import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateInstance } from '../../lib/queries/instances'
import { normalizeError } from '../../lib/toast/store'

const inputCls =
  'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40'
const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}

export function CreateInstanceDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const create = useCreateInstance()

  // IMPORTANT: do NOT include `create` in deps. The mutation object's identity
  // changes every render; including it would re-run this effect on every
  // keystroke and call setName('') after each key press — making the field
  // unusable. Only re-run when `open` flips.
  useEffect(() => {
    if (open) {
      setName('')
      setTouched(false)
      create.reset()
      // Auto-focus the input
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const trimmed = name.trim()
  const error = touched && (trimmed.length < 1 ? 'Requis'
                          : trimmed.length > 80 ? 'Trop long (80 max)' : null)
  const canSubmit = trimmed.length >= 1 && trimmed.length <= 80 && !create.isPending

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    try {
      const res = await create.mutateAsync(trimmed)
      onCreated(res.instance.id)
    } catch { /* error surfaced via mutation state */ }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
          <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
            Nouvelle connexion
          </div>
          <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
            Ajouter un numéro WhatsApp
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit}>
          <div className="px-6 py-5 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ci-name" className={labelCls}>Nom affiché</Label>
              <p className="text-[11px] text-ant-mid">
                Comment les agents verront ce numéro dans la boîte de réception.
              </p>
              <Input
                ref={inputRef}
                id="ci-name"
                type="text"
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="ex. Service client · Principal"
                disabled={create.isPending}
                maxLength={80}
                autoComplete="off"
              />
            </div>
            {error && <p className="text-[12px] text-ant-rose">{error}</p>}
            {create.error && (
              <p className="text-[12px] text-ant-rose">
                Impossible de créer le numéro : {normalizeError(create.error)}
              </p>
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={create.isPending}
              className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
            >
              {create.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {create.isPending ? 'Création…' : 'Créer et appairer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
