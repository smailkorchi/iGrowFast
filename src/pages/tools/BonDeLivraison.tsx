import { PackageCheck } from 'lucide-react';
import { ToolDocumentPage } from './ToolDocumentPage';

export default function BonDeLivraison() {
  return (
    <ToolDocumentPage
      title="Bon de livraison"
      description="Documents de livraison et bordereaux."
      icon={PackageCheck}
    />
  );
}
