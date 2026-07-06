// 1a stub for the post-pair "import phone contacts" step. The REAL
// ImportContactsModal (472L + lib/queries/contacts) is ported in the Contacts
// page phase; here we keep PairDialog's pairing/sync mechanic 100% verbatim and
// render a placeholder for the optional final step. Same props as the real one.
import { useEffect } from 'react'

export default function ImportContactsModal(props: {
  defaultInstanceId?: string
  lockInstance?: boolean
  onClose: () => void
}) {
  // Auto-close: the number is already paired + synced at this point; contact
  // import is a convenience shipped with the Contacts page. TODO(page-4): swap
  // in the real modal.
  useEffect(() => {
    const t = setTimeout(() => props.onClose(), 0)
    return () => clearTimeout(t)
  }, [props])
  return null
}
