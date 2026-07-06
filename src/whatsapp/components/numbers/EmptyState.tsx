interface Props { onAdd: () => void }

export function NumbersEmptyState({ onAdd }: Props) {
  return (
    <div className="numbers-empty">
      <div className="numbers-empty__art" aria-hidden="true">
        <div className="numbers-empty__orb numbers-empty__orb--warm" />
        <div className="numbers-empty__orb numbers-empty__orb--cool" />
        <div className="numbers-empty__orb numbers-empty__orb--natural" />
      </div>
      <h2 className="numbers-empty__title">Aucun numéro WhatsApp connecté</h2>
      <p className="numbers-empty__copy">
        Connectez un numéro WhatsApp Business pour commencer à recevoir des conversations.
        Appairez une fois, répartissez au sein de votre équipe. Reconnectez à tout moment.
      </p>
      <button type="button" className="btn btn--primary" onClick={onAdd}>
        Ajouter un numéro
      </button>
      <p className="numbers-empty__fineprint">
        L'appairage se fait par QR. Votre téléphone reste l'appareil principal.
      </p>
    </div>
  )
}
