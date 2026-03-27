import { ClipboardList } from 'lucide-react';
import { ToolDocumentPage } from './ToolDocumentPage';

export default function BonDeCommande() {
  return (
    <ToolDocumentPage
      title="Bon de commande"
      description="Bons de commande fournisseurs et achats."
      icon={ClipboardList}
    />
  );
}
