import { Plus } from 'lucide-react'
import { FaWhatsapp } from 'react-icons/fa'
import { Button } from '@/components/ui/button'

interface Props { onAdd: () => void }

export function NumbersEmptyState({ onAdd }: Props) {
  return (
    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-green/10 border border-ant-green/25 flex items-center justify-center mb-4" aria-hidden="true">
        <FaWhatsapp className="w-6 h-6 text-ant-green" />
      </div>
      <h3 className="font-display text-[18px] text-ant-ink tracking-tight">Aucun numéro WhatsApp connecté</h3>
      <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
        Connectez un numéro WhatsApp Business pour commencer à recevoir des conversations.
        Appairez une fois, répartissez au sein de votre équipe. Reconnectez à tout moment.
      </p>
      <Button
        type="button"
        onClick={onAdd}
        className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
      >
        <Plus className="w-4 h-4" strokeWidth={1.75} />
        Ajouter un numéro
      </Button>
      <p className="text-[11px] text-ant-mid mt-3">
        L'appairage se fait par QR. Votre téléphone reste l'appareil principal.
      </p>
    </div>
  )
}
