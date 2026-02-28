import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import chatSocket from '../services/chatSocket'
import useChatStore from '../stores/chatStore'
import useAuthStore from '../stores/authStore'
import ChatSidebar from '../components/ChatSidebar'
import ChatMessages from '../components/ChatMessages'
import NewDMModal from '../components/NewDMModal'
import NewChannelModal from '../components/NewChannelModal'

export default function ChatPage() {
  const { channelId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { setActiveChannel, fetchChannels } = useChatStore()
  const [showNewDM, setShowNewDM] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [mobileSidebar, setMobileSidebar] = useState(!channelId)

  // Connect WebSocket on mount
  useEffect(() => {
    chatSocket.connect()

    const unsub = chatSocket.subscribe((data) => {
      if (data.type === 'connected') {
        fetchChannels()
      } else if (data.id && data.channel_id) {
        // Chat message
        useChatStore.getState().handleIncomingMessage(data)
      }
    })

    fetchChannels()

    return () => {
      unsub()
      chatSocket.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync active channel from URL
  useEffect(() => {
    setActiveChannel(channelId || null)
    if (channelId) setMobileSidebar(false)
  }, [channelId, setActiveChannel])

  const handleSelectChannel = (id) => {
    navigate(`/chat/${id}`)
  }

  const handleDMCreated = (newChannelId) => {
    setShowNewDM(false)
    chatSocket.joinChannel(newChannelId)
    fetchChannels()
    navigate(`/chat/${newChannelId}`)
  }

  const handleChannelCreated = (newChannelId) => {
    setShowNewChannel(false)
    chatSocket.joinChannel(newChannelId)
    fetchChannels()
    navigate(`/chat/${newChannelId}`)
  }

  return (
    <div className="flex" style={{ height: 'calc(100vh - 60px)' }}>
      {/* Sidebar — hidden on mobile when viewing messages */}
      <div className={`chat-sidebar w-72 flex-shrink-0 flex flex-col
        ${mobileSidebar ? '' : 'hidden sm:flex'}`}
      >
        <ChatSidebar
          activeChannelId={channelId}
          currentUserId={user?.id}
          onSelect={handleSelectChannel}
          onNewDM={() => setShowNewDM(true)}
          onNewChannel={() => setShowNewChannel(true)}
        />
      </div>

      {/* Messages panel */}
      <div className={`flex-1 flex flex-col min-w-0
        ${!mobileSidebar ? '' : 'hidden sm:flex'}`}
      >
        {channelId ? (
          <>
            {/* Mobile back button */}
            <div className="sm:hidden px-3 py-2 border-b border-[var(--cyber-border)]">
              <button
                onClick={() => { setMobileSidebar(true); navigate('/chat') }}
                className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]"
              >
                ← Back
              </button>
            </div>
            <ChatMessages channelId={channelId} currentUserId={user?.id} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[var(--cyber-text-dim)] text-sm">Select a conversation</p>
          </div>
        )}
      </div>

      {showNewDM && (
        <NewDMModal
          onClose={() => setShowNewDM(false)}
          onCreated={handleDMCreated}
        />
      )}
      {showNewChannel && (
        <NewChannelModal
          onClose={() => setShowNewChannel(false)}
          onCreated={handleChannelCreated}
        />
      )}
    </div>
  )
}
