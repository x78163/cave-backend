import { useEffect, useRef, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import useChatStore from '../stores/chatStore'
import chatSocket from '../services/chatSocket'
import { apiFetch } from '../hooks/useApi'
import AvatarDisplay from './AvatarDisplay'
import ChannelSettingsPanel from './ChannelSettingsPanel'
import MentionAutocomplete from './MentionAutocomplete'
import UserPreviewPopover from './UserPreviewPopover'
import { parseVideoUrl, PLATFORM_LABELS, PLATFORM_COLORS } from '../utils/videoUtils'
import { TYPE_COLORS } from './EventCalendar'

function scrollToMessage(messageId) {
  const el = document.getElementById(`msg-${messageId}`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('chat-msg-highlight')
    setTimeout(() => el.classList.remove('chat-msg-highlight'), 2000)
  }
}

function formatTime(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDate(dateStr) {
  const d = new Date(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Group messages: same author within 5 minutes
function groupMessages(messages) {
  const groups = []
  let current = null
  for (const msg of messages) {
    const sameAuthor = current && current.author === msg.author
    const withinWindow = current && (new Date(msg.created_at) - new Date(current.messages[current.messages.length - 1].created_at)) < 300000
    if (sameAuthor && withinWindow) {
      current.messages.push(msg)
    } else {
      current = {
        author: msg.author,
        author_username: msg.author_username,
        author_avatar_preset: msg.author_avatar_preset,
        author_avatar: msg.author_avatar,
        messages: [msg],
      }
      groups.push(current)
    }
  }
  return groups
}

// Insert date separators
function addDateSeparators(messages) {
  const result = []
  let lastDate = null
  for (const msg of messages) {
    const date = new Date(msg.created_at).toDateString()
    if (date !== lastDate) {
      result.push({ type: 'date', date: msg.created_at })
      lastDate = date
    }
    result.push(msg)
  }
  return result
}

// Extract video preview from message — uses server data or client-side fallback
function getVideoPreview(msg) {
  if (msg.video_preview) return msg.video_preview
  // Client-side fallback for pre-migration messages
  if (!msg.content) return null
  const urlMatch = msg.content.match(/https?:\/\/\S+/)
  if (!urlMatch) return null
  const url = urlMatch[0].replace(/[.,;:!?]+$/, '')
  const parsed = parseVideoUrl(url)
  if (parsed && parsed.platform !== 'other') {
    return {
      platform: parsed.platform,
      video_id: parsed.videoId,
      embed_url: parsed.embedUrl,
      thumbnail_url: parsed.thumbnailUrl,
      original_url: url,
    }
  }
  return null
}

// Render message content with @mention highlighting and event link pills
function renderMessageContent(content, mentions) {
  // Split on @mentions and event link tokens [event:/events/{id}|{name}]
  const parts = content.split(/(@\w+|\[event:\/events\/[a-f0-9-]+\|[^\]]+\])/g)
  const mentionUsernames = mentions?.length ? new Set(mentions.map(m => m.username)) : null
  return parts.map((part, i) => {
    // Event link pill: [event:/events/{id}|{name}]
    const eventMatch = part.match(/^\[event:(\/events\/[a-f0-9-]+)\|(.+)\]$/)
    if (eventMatch) {
      return (
        <Link
          key={i}
          to={eventMatch[1]}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-medium no-underline transition-all hover:brightness-125"
          style={{ background: `${TYPE_COLORS.expedition}20`, color: TYPE_COLORS.expedition, border: `1px solid ${TYPE_COLORS.expedition}40` }}
        >
          {eventMatch[2]}
        </Link>
      )
    }
    // @mention
    if (part.startsWith('@') && mentionUsernames?.has(part.slice(1))) {
      return (
        <span key={i} className="text-[var(--cyber-cyan)] font-medium cursor-pointer hover:underline">
          {part}
        </span>
      )
    }
    return part
  })
}

const EMPTY_TYPING = {}

function TypingIndicator({ channelId }) {
  const typing = useChatStore(state => state.typing[channelId] || EMPTY_TYPING)
  const names = Object.values(typing).map(t => t.username)

  if (names.length === 0) return null

  let text
  if (names.length === 1) text = `${names[0]} is typing...`
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing...`
  else text = `${names[0]} and ${names.length - 1} others are typing...`

  return (
    <div className="px-4 py-1 text-xs text-[var(--cyber-text-dim)] animate-pulse">
      {text}
    </div>
  )
}

// ── Video Embed ──

function ChatVideoEmbed({ preview }) {
  const [playing, setPlaying] = useState(false)
  const platform = preview.platform
  const isTikTok = platform === 'tiktok'

  if (playing) {
    return (
      <div className="mt-2 max-w-md">
        <div className={`relative rounded-lg overflow-hidden border border-[var(--cyber-border)] ${isTikTok ? 'aspect-[9/16] max-h-96' : 'aspect-video'}`}>
          <iframe
            src={preview.embed_url}
            className="absolute inset-0 w-full h-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
        <button
          onClick={() => setPlaying(false)}
          className="mt-1 text-[10px] text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors"
        >
          Collapse
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 max-w-md">
      <button
        onClick={() => setPlaying(true)}
        className="relative group rounded-lg overflow-hidden border border-[var(--cyber-border)] hover:border-cyan-700/50 transition-colors block"
      >
        {preview.thumbnail_url ? (
          <img
            src={preview.thumbnail_url}
            alt="Video thumbnail"
            className="w-full aspect-video object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full aspect-video bg-[var(--cyber-surface-2)] flex items-center justify-center">
            <span className="text-3xl">&#9654;</span>
          </div>
        )}
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
          <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
            <span className="text-white text-xl ml-0.5">&#9654;</span>
          </div>
        </div>
        {/* Platform badge */}
        <span className={`absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full border font-medium ${PLATFORM_COLORS[platform] || PLATFORM_COLORS.other}`}>
          {PLATFORM_LABELS[platform] || 'Video'}
        </span>
      </button>
    </div>
  )
}

// ── Reaction Bar (pills only — picker is lifted to ChatMessages level) ──

function ReactionBar({ msg, channelId, onOpenPicker, isMe }) {
  const [tooltipData, setTooltipData] = useState(null)
  const [tooltipEmoji, setTooltipEmoji] = useState(null)
  const tooltipTimer = useRef(null)

  const reactions = msg.reactions || []
  if (reactions.length === 0 && !onOpenPicker) return null

  const handleToggleReaction = (emoji) => {
    chatSocket.sendReaction(channelId, msg.id, emoji)
  }

  const handleReactionHover = (emoji) => {
    clearTimeout(tooltipTimer.current)
    setTooltipEmoji(emoji)
    tooltipTimer.current = setTimeout(async () => {
      try {
        const data = await apiFetch(`/chat/channels/${channelId}/messages/${msg.id}/reactors/?emoji=${encodeURIComponent(emoji)}`)
        setTooltipData(data.users)
      } catch { /* ignore */ }
    }, 400)
  }

  const handleReactionLeave = () => {
    clearTimeout(tooltipTimer.current)
    setTooltipEmoji(null)
    setTooltipData(null)
  }

  return (
    <div className={`flex flex-wrap items-center gap-1 mt-1 ${isMe ? 'justify-end' : ''}`}>
      {reactions.map(r => (
        <button
          key={r.emoji}
          onClick={() => handleToggleReaction(r.emoji)}
          onMouseEnter={() => handleReactionHover(r.emoji)}
          onMouseLeave={handleReactionLeave}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors
            ${r.reacted
              ? 'border-cyan-700/50 bg-cyan-900/20 text-[var(--cyber-cyan)]'
              : 'border-[var(--cyber-border)] bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] hover:border-cyan-700/30'
            }`}
          title={tooltipEmoji === r.emoji && tooltipData ? tooltipData.map(u => u.username).join(', ') : r.emoji}
        >
          <span>{r.emoji}</span>
          <span className="text-[10px]">{r.count}</span>
        </button>
      ))}
      {/* Add reaction button */}
      <button
        onClick={onOpenPicker}
        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs border
          border-[var(--cyber-border)] bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)]
          hover:border-cyan-700/30 hover:text-[var(--cyber-cyan)] transition-colors"
        title="Add reaction"
      >
        +
      </button>
    </div>
  )
}

// ── Floating Emoji Picker (portaled to body, fixed position) ──

let emojiPickerPromise = null

function FloatingEmojiPicker({ msgId, channelId, anchorRect, onClose }) {
  const [EmojiPicker, setEmojiPicker] = useState(null)
  const pickerRef = useRef(null)

  // Lazy-load emoji picker on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!emojiPickerPromise) {
        emojiPickerPromise = Promise.all([
          import('@emoji-mart/react'),
          import('@emoji-mart/data'),
        ])
      }
      const [pickerModule, dataModule] = await emojiPickerPromise
      if (!cancelled) {
        setEmojiPicker({ Picker: pickerModule.default, data: dataModule.default })
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Close on click outside
  useEffect(() => {
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        onClose()
      }
    }
    // Delay to avoid the triggering click from immediately closing
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleSelect = (emojiData) => {
    chatSocket.sendReaction(channelId, msgId, emojiData.native)
    onClose()
  }

  // Position: above the anchor, left-aligned, clamped to viewport
  const style = {
    position: 'fixed',
    zIndex: 9999,
  }
  if (anchorRect) {
    const pickerH = 435
    const pickerW = 352
    let top = anchorRect.top - pickerH - 4
    let left = anchorRect.left
    // Clamp to viewport
    if (top < 8) top = anchorRect.bottom + 4
    if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8
    if (left < 8) left = 8
    style.top = top + 'px'
    style.left = left + 'px'
  }

  return createPortal(
    <div ref={pickerRef} style={style}>
      {EmojiPicker ? (
        <EmojiPicker.Picker
          data={EmojiPicker.data}
          onEmojiSelect={handleSelect}
          theme="dark"
          previewPosition="none"
          skinTonePosition="none"
        />
      ) : (
        <div className="bg-[var(--cyber-surface)] border border-[var(--cyber-border)] rounded-xl p-8 text-xs text-[var(--cyber-text-dim)]">
          Loading...
        </div>
      )}
    </div>,
    document.body
  )
}

export default function ChatMessages({ channelId, currentUserId, onNavigateBack }) {
  const messages = useChatStore(state => state.messages)
  const channels = useChatStore(state => state.channels)
  const loadingMessages = useChatStore(state => state.loadingMessages)
  const hasMoreMessages = useChatStore(state => state.hasMoreMessages)
  const fetchMessages = useChatStore(state => state.fetchMessages)
  const markChannelRead = useChatStore(state => state.markChannelRead)
  const pinnedMessages = useChatStore(state => state.pinnedMessages)
  const fetchPinnedMessages = useChatStore(state => state.fetchPinnedMessages)
  const messagesEndRef = useRef(null)
  const containerRef = useRef(null)
  const [atBottom, setAtBottom] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showPinnedPanel, setShowPinnedPanel] = useState(false)
  const [pickerMsgId, setPickerMsgId] = useState(null)
  const [pickerAnchorRect, setPickerAnchorRect] = useState(null)
  const [editingMsgId, setEditingMsgId] = useState(null)
  const [editText, setEditText] = useState('')
  const [replyTo, setReplyTo] = useState(null) // { id, author_username, content }
  const [popoverUser, setPopoverUser] = useState(null) // { userId, anchorRect }

  const channelMessages = messages[channelId] || []

  // Get channel info for header
  const channel = channels.find(ch => ch.id === channelId)
  const headerName = channel?.channel_type === 'dm'
    ? (channel?.other_user?.username || 'Direct Message')
    : (channel?.name || 'Channel')

  // Fetch messages when channel changes
  useEffect(() => {
    if (!channelId) return
    if (!messages[channelId]) {
      fetchMessages(channelId)
    }
    setShowSettings(false)
    // Mark as read
    const timer = setTimeout(() => markChannelRead(channelId), 500)
    return () => clearTimeout(timer)
  }, [channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mark as read when new messages arrive while focused
  useEffect(() => {
    if (channelMessages.length > 0 && atBottom) {
      markChannelRead(channelId)
    }
  }, [channelMessages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (atBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [channelMessages.length, atBottom])

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    setAtBottom(nearBottom)

    // Load more when scrolled to top
    if (el.scrollTop < 50 && hasMoreMessages[channelId] && !loadingMessages) {
      const oldestMsg = channelMessages[0]
      if (oldestMsg) {
        const prevHeight = el.scrollHeight
        fetchMessages(channelId, oldestMsg.id).then(() => {
          requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight - prevHeight
          })
        })
      }
    }
  }, [channelId, channelMessages, hasMoreMessages, loadingMessages, fetchMessages])

  const openPickerForMsg = useCallback((msgId, e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPickerMsgId(msgId)
    setPickerAnchorRect(rect)
  }, [])

  const closePicker = useCallback(() => {
    setPickerMsgId(null)
    setPickerAnchorRect(null)
  }, [])

  const withDates = addDateSeparators(channelMessages)
  const groups = []
  let dateItems = []
  for (const item of withDates) {
    if (item.type === 'date') {
      if (dateItems.length > 0) {
        groups.push(...groupMessages(dateItems))
        dateItems = []
      }
      groups.push(item)
    } else {
      dateItems.push(item)
    }
  }
  if (dateItems.length > 0) {
    groups.push(...groupMessages(dateItems))
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--cyber-border)] bg-[var(--cyber-surface)] flex items-center gap-2">
          <span className="text-[var(--cyber-cyan)] font-medium">
            {channel?.channel_type === 'dm' ? '@' : '#'}
          </span>
          <span className="text-sm font-semibold text-[var(--cyber-text)] flex-1 truncate">
            {headerName}
          </span>
          {/* Pinned messages button */}
          {(() => {
            const pinned = pinnedMessages[channelId]
            const pinCount = pinned?.length || channelMessages.filter(m => m.is_pinned).length
            return pinCount > 0 ? (
              <button
                onClick={() => {
                  if (!pinnedMessages[channelId]) fetchPinnedMessages(channelId)
                  setShowPinnedPanel(!showPinnedPanel)
                }}
                className={`text-xs px-2 py-1 rounded-full border transition-colors flex items-center gap-1
                  ${showPinnedPanel
                    ? 'border-cyan-700/50 text-[var(--cyber-cyan)]'
                    : 'border-[var(--cyber-border)] text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50'
                  }`}
                title="Pinned messages"
              >
                <span>&#128204;</span> Pinned {pinCount}
              </button>
            ) : null
          })()}
          {channel?.channel_type === 'channel' && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`text-xs px-2 py-1 rounded-full border transition-colors
                ${showSettings
                  ? 'border-cyan-700/50 text-[var(--cyber-cyan)]'
                  : 'border-[var(--cyber-border)] text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50'
                }`}
              title="Channel settings"
            >
              Settings
            </button>
          )}
        </div>

        {/* Messages */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-2"
        >
          {loadingMessages && channelMessages.length === 0 && (
            <div className="text-center text-xs text-[var(--cyber-text-dim)] py-8">Loading...</div>
          )}

          {hasMoreMessages[channelId] && !loadingMessages && (
            <div className="text-center text-xs text-[var(--cyber-text-dim)] py-2">
              Scroll up for older messages
            </div>
          )}

          {groups.map((group, gi) => {
            if (group.type === 'date') {
              return (
                <div key={`date-${gi}`} className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-[var(--cyber-border)]" />
                  <span className="text-[10px] text-[var(--cyber-text-dim)] font-medium">
                    {formatDate(group.date)}
                  </span>
                  <div className="flex-1 h-px bg-[var(--cyber-border)]" />
                </div>
              )
            }

            const isMe = group.author === currentUserId
            return (
              <div key={`group-${gi}`} className={`chat-message-group flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                <div className="flex-shrink-0 w-8 pt-0.5">
                  <AvatarDisplay
                    user={{ avatar: group.author_avatar, avatar_preset: group.author_avatar_preset, username: group.author_username }}
                    size="w-8 h-8"
                    textSize="text-xs"
                  />
                </div>
                <div className={`flex-1 min-w-0 max-w-[75%] ${isMe ? 'flex flex-col items-end' : ''}`}>
                  <div className={`flex items-baseline gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                    <button
                      onClick={(e) => setPopoverUser({ userId: group.author, anchorRect: e.currentTarget.getBoundingClientRect() })}
                      className={`text-sm font-semibold hover:underline cursor-pointer ${isMe ? 'text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text)]'}`}
                    >
                      {group.author_username}
                    </button>
                    <span className="text-[10px] text-[var(--cyber-text-dim)]">
                      {formatTime(group.messages[0].created_at)}
                    </span>
                  </div>
                  {group.messages.map(msg => {
                    const videoPreview = msg.is_deleted ? null : getVideoPreview(msg)
                    const hasReactions = !msg.is_deleted && msg.reactions && msg.reactions.length > 0
                    const isEditing = editingMsgId === msg.id
                    const isOwner = channel?.members?.some(m => m.id === currentUserId && m.role === 'owner')
                    const canEdit = msg.author === currentUserId && !msg.is_deleted
                    const canDelete = (msg.author === currentUserId || isOwner) && !msg.is_deleted

                    return (
                      <div key={msg.id} id={`msg-${msg.id}`} className={`mt-1 relative group/msg ${isMe ? 'flex flex-col items-end' : ''}`}>
                        {/* Reply-to preview */}
                        {msg.reply_to_preview && (
                          <button
                            onClick={() => scrollToMessage(msg.reply_to_preview.id)}
                            className={`flex items-center gap-1.5 mb-1 text-[11px] text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors max-w-full truncate ${isMe ? 'flex-row-reverse' : ''}`}
                          >
                            <span className="w-0.5 h-4 bg-cyan-700/50 rounded-full flex-shrink-0" />
                            <span className="truncate">
                              <span className="font-medium">@{msg.reply_to_preview.author_username}</span>
                              {' '}{msg.reply_to_preview.content.slice(0, 60)}
                            </span>
                          </button>
                        )}

                        {/* Deleted message */}
                        {msg.is_deleted ? (
                          <div className="inline-block px-3 py-1.5 rounded-2xl text-sm italic text-[var(--cyber-text-dim)]/50">
                            [This message was deleted]
                          </div>
                        ) : isEditing ? (
                          /* Inline edit mode */
                          <div className="w-full max-w-md">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="w-full cyber-input px-3 py-1.5 text-sm rounded-lg resize-none"
                              rows={2}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault()
                                  const trimmed = editText.trim()
                                  if (trimmed && trimmed !== msg.content) {
                                    apiFetch(`/chat/channels/${channelId}/messages/${msg.id}/`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ content: trimmed }),
                                    }).catch(() => {})
                                  }
                                  setEditingMsgId(null)
                                }
                                if (e.key === 'Escape') setEditingMsgId(null)
                              }}
                            />
                            <div className="flex gap-2 mt-1">
                              <button
                                onClick={() => {
                                  const trimmed = editText.trim()
                                  if (trimmed && trimmed !== msg.content) {
                                    apiFetch(`/chat/channels/${channelId}/messages/${msg.id}/`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ content: trimmed }),
                                    }).catch(() => {})
                                  }
                                  setEditingMsgId(null)
                                }}
                                className="text-[10px] text-[var(--cyber-cyan)] hover:underline"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingMsgId(null)}
                                className="text-[10px] text-[var(--cyber-text-dim)] hover:underline"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {msg.content && (
                              <div className={`inline-block px-3 py-1.5 rounded-2xl text-sm break-words whitespace-pre-wrap max-w-full
                                ${isMe
                                  ? 'bg-[var(--cyber-cyan)]/15 border border-cyan-700/30 text-[var(--cyber-text)] rounded-tr-sm'
                                  : 'bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)] text-[var(--cyber-text)] rounded-tl-sm'
                                }`}
                              >
                                {renderMessageContent(msg.content, msg.mentions)}
                                {msg.edited_at && (
                                  <span className="text-[10px] text-[var(--cyber-text-dim)]/60 ml-1.5">(edited)</span>
                                )}
                              </div>
                            )}
                            {msg.image_url && (
                              <div className="mt-1 max-w-sm">
                                <img
                                  src={msg.image_url}
                                  alt="shared"
                                  className="rounded-lg max-h-72 cursor-pointer hover:opacity-90 border border-[var(--cyber-border)]"
                                  onClick={() => window.open(msg.image_url, '_blank')}
                                  loading="lazy"
                                />
                              </div>
                            )}
                            {msg.file_url && !msg.image_url && (
                              <a
                                href={msg.file_url}
                                download={msg.file_name}
                                className="mt-1 inline-flex items-center gap-2 px-3 py-2 rounded-lg
                                  bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                                  hover:border-cyan-700/50 transition-colors text-sm"
                              >
                                <span className="text-[var(--cyber-cyan)]">&#128206;</span>
                                <span className="text-[var(--cyber-text)]">{msg.file_name}</span>
                                <span className="text-[var(--cyber-text-dim)] text-xs">
                                  {formatFileSize(msg.file_size)}
                                </span>
                              </a>
                            )}
                            {videoPreview && (
                              <ChatVideoEmbed preview={videoPreview} />
                            )}
                          </>
                        )}

                        {/* Pin indicator */}
                        {msg.is_pinned && !msg.is_deleted && (
                          <div className="text-[10px] text-[var(--cyber-text-dim)] mt-0.5 flex items-center gap-1">
                            <span>&#128204;</span> Pinned{msg.pinned_by_username ? ` by ${msg.pinned_by_username}` : ''}
                          </div>
                        )}

                        {/* Reaction pills */}
                        {hasReactions && (
                          <ReactionBar msg={msg} channelId={channelId} isMe={isMe} onOpenPicker={(e) => openPickerForMsg(msg.id, e)} />
                        )}

                        {/* Reply count */}
                        {msg.reply_count > 0 && (
                          <button
                            onClick={() => scrollToMessage(msg.id)}
                            className="text-[11px] text-[var(--cyber-cyan)] hover:underline mt-0.5"
                          >
                            {msg.reply_count} {msg.reply_count === 1 ? 'reply' : 'replies'}
                          </button>
                        )}

                        {/* Hover action bar */}
                        {!msg.is_deleted && (
                          <div className={`chat-hover-react opacity-0 group-hover/msg:opacity-100 absolute -top-3
                            flex items-center gap-0.5 rounded-full border border-[var(--cyber-border)]
                            bg-[var(--cyber-surface)] shadow-lg z-10 px-1
                            ${isMe ? 'left-0' : 'right-0'}`}
                          >
                            <button
                              onClick={(e) => openPickerForMsg(msg.id, e)}
                              className="p-1 text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors"
                              title="React"
                            >&#128578;</button>
                            <button
                              onClick={() => setReplyTo({ id: msg.id, author_username: msg.author_username || group.author_username, content: msg.content })}
                              className="p-1 text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors"
                              title="Reply"
                            >&#8617;</button>
                            <button
                              onClick={() => {
                                apiFetch(`/chat/channels/${channelId}/messages/${msg.id}/pin/`, {
                                  method: 'POST',
                                }).catch(() => {})
                              }}
                              className={`p-1 text-xs transition-colors ${msg.is_pinned ? 'text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'}`}
                              title={msg.is_pinned ? 'Unpin' : 'Pin'}
                            >&#128204;</button>
                            {canEdit && (
                              <button
                                onClick={() => { setEditingMsgId(msg.id); setEditText(msg.content) }}
                                className="p-1 text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors"
                                title="Edit"
                              >&#9998;</button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => {
                                  if (confirm('Delete this message?')) {
                                    apiFetch(`/chat/channels/${channelId}/messages/${msg.id}/`, {
                                      method: 'DELETE',
                                    }).catch(() => {})
                                  }
                                }}
                                className="p-1 text-xs text-[var(--cyber-text-dim)] hover:text-red-400 transition-colors"
                                title="Delete"
                              >&#128465;</button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <div ref={messagesEndRef} />
        </div>

        {/* Typing indicator */}
        <TypingIndicator channelId={channelId} />

        {/* Reply preview bar */}
        {replyTo && (
          <div className="px-4 py-2 border-t border-[var(--cyber-border)] bg-[var(--cyber-surface)] flex items-center gap-2">
            <span className="w-0.5 h-6 bg-cyan-700/50 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[11px] text-[var(--cyber-text-dim)]">Replying to </span>
              <span className="text-[11px] text-[var(--cyber-cyan)] font-medium">@{replyTo.author_username}</span>
              <p className="text-xs text-[var(--cyber-text-dim)] truncate">{replyTo.content?.slice(0, 80)}</p>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="text-[var(--cyber-text-dim)] hover:text-white text-sm flex-shrink-0"
            >&times;</button>
          </div>
        )}

        {/* Composer */}
        <ChatComposer channelId={channelId} replyTo={replyTo} onReplySent={() => setReplyTo(null)} />
      </div>

      {/* Settings panel */}
      {showSettings && channel?.channel_type === 'channel' && (
        <ChannelSettingsPanel
          channelId={channelId}
          onClose={() => setShowSettings(false)}
          onDeleted={onNavigateBack}
          onLeft={onNavigateBack}
        />
      )}

      {/* Pinned messages panel */}
      {showPinnedPanel && (
        <div className="w-72 flex-shrink-0 border-l border-[var(--cyber-border)] bg-[var(--cyber-surface)] flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--cyber-border)] flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--cyber-text)]">Pinned Messages</span>
            <button onClick={() => setShowPinnedPanel(false)} className="text-[var(--cyber-text-dim)] hover:text-white">&times;</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {(pinnedMessages[channelId] || []).map(msg => (
              <div
                key={msg.id}
                className="p-2 rounded-lg bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)] cursor-pointer hover:border-cyan-700/30 transition-colors"
                onClick={() => { scrollToMessage(msg.id); setShowPinnedPanel(false) }}
              >
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-xs font-medium text-[var(--cyber-text)]">{msg.author_username}</span>
                  <span className="text-[10px] text-[var(--cyber-text-dim)]">{formatTime(msg.created_at)}</span>
                </div>
                <p className="text-xs text-[var(--cyber-text-dim)] line-clamp-3">{msg.content}</p>
              </div>
            ))}
            {(!pinnedMessages[channelId] || pinnedMessages[channelId].length === 0) && (
              <p className="text-xs text-[var(--cyber-text-dim)] text-center py-4">No pinned messages</p>
            )}
          </div>
        </div>
      )}

      {/* Floating emoji picker (portaled to body) */}
      {pickerMsgId && (
        <FloatingEmojiPicker
          msgId={pickerMsgId}
          channelId={channelId}
          anchorRect={pickerAnchorRect}
          onClose={closePicker}
        />
      )}

      {/* User preview popover */}
      {popoverUser && (
        <UserPreviewPopover
          userId={popoverUser.userId}
          anchorRect={popoverUser.anchorRect}
          onClose={() => setPopoverUser(null)}
          currentUserId={currentUserId}
        />
      )}
    </div>
  )
}

function ChatComposer({ channelId, replyTo, onReplySent }) {
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [preview, setPreview] = useState(null)
  const [sending, setSending] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [ComposerPicker, setComposerPicker] = useState(null)
  const [mentionQuery, setMentionQuery] = useState(null)
  const [mentionAnchorRect, setMentionAnchorRect] = useState(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const typingTimerRef = useRef(null)
  const emojiButtonRef = useRef(null)
  const emojiPickerRef = useRef(null)

  // Clean up typing timer and preview URL on unmount
  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current)
      if (preview) URL.revokeObjectURL(preview)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if ((!trimmed && !attachment) || !channelId || sending) return

    if (attachment) {
      // Use REST for file uploads
      setSending(true)
      try {
        const form = new FormData()
        if (trimmed) form.append('content', trimmed)
        if (attachment.type.startsWith('image/')) {
          form.append('image', attachment)
        } else {
          form.append('file', attachment)
        }
        if (replyTo?.id) form.append('reply_to', replyTo.id)
        await apiFetch(`/chat/channels/${channelId}/send/`, {
          method: 'POST',
          body: form,
        })
      } catch { /* ignore — WS broadcast will handle display */ }
      setSending(false)
      setAttachment(null)
      if (preview) { URL.revokeObjectURL(preview); setPreview(null) }
    } else {
      // Use WebSocket for text-only (faster)
      chatSocket.sendMessage(channelId, trimmed, replyTo?.id || null)
    }
    if (replyTo) onReplySent?.()
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, attachment, channelId, sending, preview])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e) => {
    const newText = e.target.value
    setText(newText)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'

    // Detect @mention pattern
    const cursorPos = el.selectionStart
    const textBeforeCursor = newText.slice(0, cursorPos)
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/)
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1])
      setMentionAnchorRect(el.getBoundingClientRect())
    } else {
      setMentionQuery(null)
    }

    // Typing indicator (debounced: once per 2s)
    if (!typingTimerRef.current) {
      chatSocket.sendTyping(channelId)
      typingTimerRef.current = setTimeout(() => {
        typingTimerRef.current = null
      }, 2000)
    }
  }

  const handleMentionSelect = useCallback((user) => {
    const ta = textareaRef.current
    if (!ta) return
    const cursorPos = ta.selectionStart
    const textBefore = text.slice(0, cursorPos)
    const textAfter = text.slice(cursorPos)
    // Replace @partial with @username
    const newBefore = textBefore.replace(/@\w*$/, `@${user.username} `)
    setText(newBefore + textAfter)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = newBefore.length
      ta.focus()
    })
  }, [text])

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 15 * 1024 * 1024) {
      alert('File too large (max 15MB)')
      return
    }
    setAttachment(file)
    if (file.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(file))
    } else {
      if (preview) URL.revokeObjectURL(preview)
      setPreview(null)
    }
    e.target.value = '' // Reset so same file can be selected again
  }

  const handlePaste = (e) => {
    const files = e.clipboardData?.files
    if (files?.length > 0) {
      const file = files[0]
      if (file.size > 15 * 1024 * 1024) return
      setAttachment(file)
      if (file.type.startsWith('image/')) {
        setPreview(URL.createObjectURL(file))
      }
    }
  }

  const clearAttachment = () => {
    setAttachment(null)
    if (preview) { URL.revokeObjectURL(preview); setPreview(null) }
  }

  const toggleEmojiPicker = useCallback(async () => {
    if (showEmojiPicker) {
      setShowEmojiPicker(false)
      return
    }
    if (!ComposerPicker) {
      if (!emojiPickerPromise) {
        emojiPickerPromise = Promise.all([
          import('@emoji-mart/react'),
          import('@emoji-mart/data'),
        ])
      }
      const [pickerModule, dataModule] = await emojiPickerPromise
      setComposerPicker({ Picker: pickerModule.default, data: dataModule.default })
    }
    setShowEmojiPicker(true)
  }, [showEmojiPicker, ComposerPicker])

  const handleEmojiInsert = useCallback((emojiData) => {
    const emoji = emojiData.native
    const ta = textareaRef.current
    if (ta) {
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newText = text.slice(0, start) + emoji + text.slice(end)
      setText(newText)
      // Restore cursor position after emoji
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + emoji.length
        ta.focus()
      })
    } else {
      setText(text + emoji)
    }
    setShowEmojiPicker(false)
  }, [text])

  // Close composer emoji picker on click outside
  useEffect(() => {
    if (!showEmojiPicker) return
    const handleClick = (e) => {
      if (
        emojiPickerRef.current && !emojiPickerRef.current.contains(e.target) &&
        emojiButtonRef.current && !emojiButtonRef.current.contains(e.target)
      ) {
        setShowEmojiPicker(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [showEmojiPicker])

  return (
    <div className="chat-composer relative">
      {/* Attachment preview */}
      {attachment && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]">
          {preview ? (
            <img src={preview} alt="preview" className="w-12 h-12 rounded object-cover" />
          ) : (
            <span className="text-sm">&#128206;</span>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[var(--cyber-text)] truncate">{attachment.name}</p>
            <p className="text-[10px] text-[var(--cyber-text-dim)]">{formatFileSize(attachment.size)}</p>
          </div>
          <button onClick={clearAttachment} className="text-[var(--cyber-text-dim)] hover:text-white text-sm">&times;</button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors px-1 py-2 text-lg"
          title="Attach file"
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.txt,.csv,.zip"
        />

        {/* Emoji button */}
        <button
          ref={emojiButtonRef}
          onClick={toggleEmojiPicker}
          className={`transition-colors px-1 py-2 text-lg ${showEmojiPicker ? 'text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'}`}
          title="Insert emoji"
        >
          &#128578;
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 cyber-input px-4 py-2 text-sm resize-none"
          style={{ borderRadius: '1.25rem', minHeight: '2.5rem', maxHeight: '7.5rem' }}
        />
        <button
          onClick={handleSend}
          disabled={(!text.trim() && !attachment) || sending}
          className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderRadius: '1.25rem' }}
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>

      {/* Composer emoji picker */}
      {showEmojiPicker && ComposerPicker && createPortal(
        <div
          ref={emojiPickerRef}
          style={{
            position: 'fixed',
            zIndex: 9999,
            bottom: (window.innerHeight - (emojiButtonRef.current?.getBoundingClientRect().top || 0) + 8) + 'px',
            left: Math.max(8, Math.min(
              (emojiButtonRef.current?.getBoundingClientRect().left || 0),
              window.innerWidth - 360
            )) + 'px',
          }}
        >
          <ComposerPicker.Picker
            data={ComposerPicker.data}
            onEmojiSelect={handleEmojiInsert}
            theme="dark"
            previewPosition="none"
            skinTonePosition="none"
          />
        </div>,
        document.body
      )}

      {/* @Mention autocomplete */}
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          anchorRect={mentionAnchorRect}
          onSelect={handleMentionSelect}
          onClose={() => setMentionQuery(null)}
        />
      )}
    </div>
  )
}
