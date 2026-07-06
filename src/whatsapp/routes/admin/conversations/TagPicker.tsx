import { useEffect, useRef } from 'react'
import {
  useTags,
  useConversationTags,
  useAssignTag,
  useUnassignTag,
  type Tag,
} from '../../../lib/queries/tags'
import { IconCheck, IconPlus } from './icons'

export interface TagPickerProps {
  instanceId: string | null
  conversationId: string
  onClose: () => void
  onCreate: () => void
  // Wrapper around the trigger button. Clicks inside it must NOT close the
  // picker — otherwise the trigger's own click handler fires immediately
  // after the mousedown-close, re-opening the picker (toggle never works).
  anchorRef?: React.RefObject<HTMLElement | null>
}

export function TagPicker({
  instanceId, conversationId, onClose, onCreate, anchorRef,
}: TagPickerProps) {
  const { data: tags } = useTags(instanceId)
  const { data: convTags } = useConversationTags(conversationId)
  const assignMut = useAssignTag()
  const unassignMut = useUnassignTag()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (ref.current && ref.current.contains(target)) return
      if (anchorRef?.current && anchorRef.current.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, anchorRef])

  const assignedIds = new Set(convTags?.map((ct) => ct.tag_id) ?? [])

  const toggle = (tag: Tag) => {
    if (assignedIds.has(tag.id)) {
      unassignMut.mutate({ conversationId, tagId: tag.id })
    } else {
      assignMut.mutate({ conversationId, tagId: tag.id })
    }
  }

  return (
    <div className="wac__tag-picker" ref={ref}>
      <div className="wac__tag-picker-head">
        <span>Étiquettes</span>
        <button
          className="wac__icon-btn"
          onClick={onCreate}
          aria-label="Nouvelle étiquette"
          title="Nouvelle étiquette"
        >
          <IconPlus size={16} />
        </button>
      </div>
      <div className="wac__tag-picker-list">
        {(!tags || tags.length === 0) && (
          <div className="wac__tag-picker-empty">Aucune étiquette créée</div>
        )}
        {tags?.map((tag) => {
          const isAssigned = assignedIds.has(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              className={'wac__tag-picker-item' + (isAssigned ? ' is-assigned' : '')}
              onClick={() => toggle(tag)}
            >
              <span className="wac__tag-dot" style={{ background: tag.color }} />
              <span className="wac__tag-picker-name">{tag.name}</span>
              {isAssigned && <IconCheck size={16} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
