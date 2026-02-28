/**
 * WebSocket singleton for real-time chat.
 * Single connection per user, multiplexed across all channels via Redis groups.
 */
class ChatSocketService {
  constructor() {
    this.ws = null
    this.listeners = new Set()
    this.reconnectTimer = null
    this.reconnectDelay = 1000
    this.maxReconnectDelay = 30000
  }

  connect() {
    const token = localStorage.getItem('access_token')
    if (!token || this.ws?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    this.ws = new WebSocket(`${protocol}//${host}/ws/chat/?token=${token}`)

    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      this._notify({ type: 'connected' })
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this._notify(data)
      } catch { /* ignore malformed */ }
    }

    this.ws.onclose = (event) => {
      this.ws = null
      if (event.code === 4001) {
        // Auth failure — don't reconnect
        this._notify({ type: 'auth_error' })
        return
      }
      this._scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose fires after onerror
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimer)
    if (this.ws) {
      this.ws.close(1000)
      this.ws = null
    }
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  sendMessage(channelId, content) {
    this.send({ type: 'chat.message', channel_id: channelId, content })
  }

  markRead(channelId, messageId) {
    this.send({ type: 'chat.mark_read', channel_id: channelId, message_id: messageId })
  }

  joinChannel(channelId) {
    this.send({ type: 'chat.join_channel', channel_id: channelId })
  }

  sendTyping(channelId) {
    this.send({ type: 'chat.typing', channel_id: channelId })
  }

  sendReaction(channelId, messageId, emoji) {
    this.send({ type: 'chat.react', channel_id: channelId, message_id: messageId, emoji })
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  _notify(data) {
    this.listeners.forEach(fn => fn(data))
  }

  _scheduleReconnect() {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }
}

const chatSocket = new ChatSocketService()
export default chatSocket
