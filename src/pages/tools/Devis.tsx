import { FileSpreadsheet } from 'lucide-react';
import { ToolDocumentPage } from './ToolDocumentPage';

export default function Devis() {
  return (
    <ToolDocumentPage
      title="Devis"
      description="Création et suivi des devis clients."
      icon={FileSpreadsheet}
    />
  );
}
