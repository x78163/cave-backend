import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import chatSocket from '../services/chatSocket'
import useChatStore from '../stores/chatStore'
import useAuthStore from '../stores/authStore'
import ChatSidebar from '../components/ChatSidebar'
import ChatMessages from '../components/ChatMessages'
import NewDMModal from '../components/NewDMModal'
import NewChannelModal from '../components/NewChannelModal'
import BrowseChannelsModal from '../components/BrowseChannelsModal'

// Note: WebSocket connection is managed globally in App.jsx

export default function ChatPage() {
  const { channelId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const setActiveChannel = useChatStore(state => state.setActiveChannel)
  const fetchChannels = useChatStore(state => state.fetchChannels)
  const [showNewDM, setShowNewDM] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showBrowse, setShowBrowse] = useState(false)
  const [mobileSidebar, setMobileSidebar] = useState(!channelId)

  // WebSocket is connected globally in App.jsx — just fetch channels on mount
  useEffect(() => {
    fetchChannels()
  }, [fetchChannels])

  // Sync active channel from URL
  useEffect(() => {
    setActiveChannel(channelId || null)
    if (channelId) {
      setMobileSidebar(false)
      // If channel isn't in the store yet (e.g. navigated from profile popover),
      // refresh channels and join the WS group
      const channels = useChatStore.getState().channels
      if (!channels.find(ch => ch.id === channelId)) {
        chatSocket.joinChannel(channelId)
        fetchChannels()
      }
    }
  }, [channelId, setActiveChannel, fetchChannels])

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

  const handleBrowseJoined = (joinedChannelId) => {
    setShowBrowse(false)
    chatSocket.joinChannel(joinedChannelId)
    fetchChannels()
    navigate(`/chat/${joinedChannelId}`)
  }

  const handleNavigateBack = () => {
    useChatStore.getState().removeChannel(channelId)
    navigate('/chat')
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
          onBrowse={() => setShowBrowse(true)}
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
                &larr; Back
              </button>
            </div>
            <ChatMessages
              channelId={channelId}
              currentUserId={user?.id}
              onNavigateBack={handleNavigateBack}
            />
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
      {showBrowse && (
        <BrowseChannelsModal
          onClose={() => setShowBrowse(false)}
          onJoined={handleBrowseJoined}
        />
      )}
    </div>
  )
}
