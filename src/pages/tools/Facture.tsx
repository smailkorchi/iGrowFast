import { Receipt } from 'lucide-react';
import { ToolDocumentPage } from './ToolDocumentPage';

export default function Facture() {
  return (
    <ToolDocumentPage
      title="Facture"
      description="Facturation et historique des factures."
      icon={Receipt}
    />
  );
}
