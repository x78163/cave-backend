import { create } from 'zustand'
import api from '../services/api'
import chatSocket from '../services/chatSocket'

const useChatStore = create((set, get) => ({
  channels: [],
  activeChannelId: null,
  messages: {},           // { channelId: [msg, ...] }
  totalUnread: 0,
  loadingChannels: false,
  loadingMessages: false,
  hasMoreMessages: {},    // { channelId: boolean }
  typing: {},             // { channelId: { userId: { username, timeout } } }

  fetchChannels: async () => {
    set({ loadingChannels: true })
    try {
      const { data } = await api.get('/chat/channels/')
      const totalUnread = data.reduce((sum, ch) => sum + (ch.unread_count || 0), 0)
      set({ channels: data, totalUnread, loadingChannels: false })
    } catch {
      set({ loadingChannels: false })
    }
  },

  fetchMessages: async (channelId, before = null) => {
    set({ loadingMessages: true })
    try {
      const params = before ? `?before=${before}&limit=50` : '?limit=50'
      const { data } = await api.get(`/chat/channels/${channelId}/messages/${params}`)
      set(state => {
        const existing = before ? (state.messages[channelId] || []) : []
        return {
          messages: {
            ...state.messages,
            [channelId]: [...data.messages, ...existing],
          },
          hasMoreMessages: {
            ...state.hasMoreMessages,
            [channelId]: data.has_more,
          },
          loadingMessages: false,
        }
      })
    } catch {
      set({ loadingMessages: false })
    }
  },

  setActiveChannel: (channelId) => {
    set({ activeChannelId: channelId })
  },

  handleIncomingMessage: (message) => {
    set(state => {
      const channelId = message.channel_id
      const channelMessages = state.messages[channelId] || []

      // Deduplicate
      if (channelMessages.some(m => m.id === message.id)) return state

      const newMessages = {
        ...state.messages,
        [channelId]: [...channelMessages, message],
      }

      // Update channel list
      const isActive = state.activeChannelId === channelId
      const updatedChannels = state.channels.map(ch => {
        if (ch.id === channelId) {
          return {
            ...ch,
            last_message: {
              id: message.id,
              content: message.content,
              author_username: message.author_username,
              created_at: message.created_at,
            },
            unread_count: isActive ? ch.unread_count : ch.unread_count + 1,
          }
        }
        return ch
      }).sort((a, b) => {
        const aTime = a.last_message?.created_at || a.updated_at
        const bTime = b.last_message?.created_at || b.updated_at
        return new Date(bTime) - new Date(aTime)
      })

      // If channel doesn't exist in list yet, refetch
      if (!updatedChannels.some(ch => ch.id === channelId)) {
        get().fetchChannels()
      }

      const totalUnread = updatedChannels.reduce(
        (sum, ch) => sum + (ch.unread_count || 0), 0
      )

      return { messages: newMessages, channels: updatedChannels, totalUnread }
    })
  },

  markChannelRead: (channelId) => {
    const state = get()
    const channelMessages = state.messages[channelId] || []
    if (channelMessages.length === 0) return

    // Skip if already read
    const channel = state.channels.find(ch => ch.id === channelId)
    if (channel && channel.unread_count === 0) return

    const lastMessage = channelMessages[channelMessages.length - 1]
    chatSocket.markRead(channelId, lastMessage.id)

    // Also update via REST for durability
    api.post(`/chat/channels/${channelId}/mark-read/`, {
      message_id: lastMessage.id,
    }).catch(() => {})

    set(state => {
      const updatedChannels = state.channels.map(ch =>
        ch.id === channelId ? { ...ch, unread_count: 0 } : ch
      )
      const totalUnread = updatedChannels.reduce(
        (sum, ch) => sum + (ch.unread_count || 0), 0
      )
      return { channels: updatedChannels, totalUnread }
    })
  },

  fetchUnreadCount: async () => {
    try {
      const { data } = await api.get('/chat/unread-count/')
      set({ totalUnread: data.total_unread })
    } catch { /* ignore */ }
  },

  clearMessages: (channelId) => {
    set(state => {
      const { [channelId]: _, ...rest } = state.messages
      return { messages: rest }
    })
  },

  removeChannel: (channelId) => {
    set(state => {
      const { [channelId]: _, ...restMessages } = state.messages
      const channels = state.channels.filter(ch => ch.id !== channelId)
      const totalUnread = channels.reduce((sum, ch) => sum + (ch.unread_count || 0), 0)
      return { channels, messages: restMessages, totalUnread }
    })
  },

  handleReactionUpdate: (data, currentUserId) => {
    const { channel_id, message_id, reactions, actor_id, action, emoji } = data
    set(state => {
      const channelMessages = state.messages[channel_id]
      if (!channelMessages) return state

      const updatedMessages = channelMessages.map(msg => {
        if (msg.id !== message_id) return msg

        // Merge server counts with local reacted state
        const newReactions = reactions.map(r => ({
          emoji: r.emoji,
          count: r.count,
          // If current user is the actor, we know their reacted state
          reacted: actor_id === currentUserId
            ? (r.emoji === emoji ? action === 'added' : (msg.reactions?.find(mr => mr.emoji === r.emoji)?.reacted || false))
            : (msg.reactions?.find(mr => mr.emoji === r.emoji)?.reacted || false),
        }))

        return { ...msg, reactions: newReactions }
      })

      return {
        messages: { ...state.messages, [channel_id]: updatedMessages },
      }
    })
  },

  handleTypingEvent: (data) => {
    const { channel_id, user_id, username } = data
    set(state => {
      const channelTyping = { ...(state.typing[channel_id] || {}) }

      // Clear previous timeout for this user
      if (channelTyping[user_id]?.timeout) {
        clearTimeout(channelTyping[user_id].timeout)
      }

      // Auto-clear after 3 seconds
      const timeout = setTimeout(() => {
        set(s => {
          const updated = { ...(s.typing[channel_id] || {}) }
          delete updated[user_id]
          return { typing: { ...s.typing, [channel_id]: updated } }
        })
      }, 3000)

      channelTyping[user_id] = { username, timeout }
      return { typing: { ...state.typing, [channel_id]: channelTyping } }
    })
  },
}))

export default useChatStore
