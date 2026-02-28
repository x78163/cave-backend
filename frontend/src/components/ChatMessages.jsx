import { useEffect, useRef, useCallback, useState } from 'react'
import useChatStore from '../stores/chatStore'
import chatSocket from '../services/chatSocket'
import AvatarDisplay from './AvatarDisplay'

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

export default function ChatMessages({ channelId, currentUserId }) {
  const {
    messages, fetchMessages, markChannelRead,
    loadingMessages, hasMoreMessages, channels,
  } = useChatStore()
  const messagesEndRef = useRef(null)
  const containerRef = useRef(null)
  const [atBottom, setAtBottom] = useState(true)

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
          // Preserve scroll position
          requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight - prevHeight
          })
        })
      }
    }
  }, [channelId, channelMessages, hasMoreMessages, loadingMessages, fetchMessages])

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--cyber-border)] bg-[var(--cyber-surface)] flex items-center gap-2">
        <span className="text-[var(--cyber-cyan)] font-medium">
          {channel?.channel_type === 'dm' ? '@' : '#'}
        </span>
        <span className="text-sm font-semibold text-[var(--cyber-text)]">
          {headerName}
        </span>
        {channel?.channel_type === 'channel' && channel?.description && (
          <span className="text-xs text-[var(--cyber-text-dim)] ml-2 truncate">
            — {channel.description}
          </span>
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
            <div key={`group-${gi}`} className="chat-message-group flex gap-3">
              <div className="flex-shrink-0 w-8 pt-0.5">
                <AvatarDisplay
                  user={{ avatar_preset: group.author_avatar_preset, username: group.author_username }}
                  size="w-8 h-8"
                  textSize="text-xs"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-semibold ${isMe ? 'text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text)]'}`}>
                    {group.author_username}
                  </span>
                  <span className="text-[10px] text-[var(--cyber-text-dim)]">
                    {formatTime(group.messages[0].created_at)}
                  </span>
                </div>
                {group.messages.map(msg => (
                  <p key={msg.id} className="text-sm text-[var(--cyber-text)] mt-0.5 break-words whitespace-pre-wrap">
                    {msg.content}
                  </p>
                ))}
              </div>
            </div>
          )
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <ChatComposer channelId={channelId} />
    </div>
  )
}

function ChatComposer({ channelId }) {
  const [text, setText] = useState('')
  const textareaRef = useRef(null)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || !channelId) return
    chatSocket.sendMessage(channelId, trimmed)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, channelId])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize textarea
  const handleInput = (e) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  return (
    <div className="chat-composer flex items-end gap-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        rows={1}
        className="flex-1 cyber-input px-4 py-2 text-sm resize-none"
        style={{ borderRadius: '1.25rem', minHeight: '2.5rem', maxHeight: '7.5rem' }}
      />
      <button
        onClick={handleSend}
        disabled={!text.trim()}
        className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ borderRadius: '1.25rem' }}
      >
        Send
      </button>
    </div>
  )
}
