import useChatStore from '../stores/chatStore'
import AvatarDisplay from './AvatarDisplay'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

export default function ChatSidebar({ activeChannelId, currentUserId, onSelect, onNewDM, onNewChannel }) {
  const { channels, loadingChannels } = useChatStore()

  const dmChannels = channels.filter(ch => ch.channel_type === 'dm')
  const groupChannels = channels.filter(ch => ch.channel_type === 'channel')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--cyber-border)] flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--cyber-text)]">Messages</span>
        <div className="flex gap-1">
          <button
            onClick={onNewDM}
            className="px-2 py-1 text-[10px] rounded-full text-[var(--cyber-text-dim)]
              border border-[var(--cyber-border)] hover:text-[var(--cyber-cyan)]
              hover:border-cyan-700/50 transition-colors"
            title="New DM"
          >
            + DM
          </button>
          <button
            onClick={onNewChannel}
            className="px-2 py-1 text-[10px] rounded-full text-[var(--cyber-text-dim)]
              border border-[var(--cyber-border)] hover:text-[var(--cyber-cyan)]
              hover:border-cyan-700/50 transition-colors"
            title="New Channel"
          >
            + Channel
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadingChannels && channels.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[var(--cyber-text-dim)]">
            Loading...
          </div>
        )}

        {/* Group Channels */}
        {groupChannels.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1 text-[10px] font-semibold text-[var(--cyber-text-dim)] uppercase tracking-wider">
              Channels
            </div>
            {groupChannels.map(ch => (
              <ChannelItem
                key={ch.id}
                channel={ch}
                active={ch.id === activeChannelId}
                onClick={() => onSelect(ch.id)}
              />
            ))}
          </>
        )}

        {/* DMs */}
        {dmChannels.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1 text-[10px] font-semibold text-[var(--cyber-text-dim)] uppercase tracking-wider">
              Direct Messages
            </div>
            {dmChannels.map(ch => (
              <DMItem
                key={ch.id}
                channel={ch}
                active={ch.id === activeChannelId}
                currentUserId={currentUserId}
                onClick={() => onSelect(ch.id)}
              />
            ))}
          </>
        )}

        {!loadingChannels && channels.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[var(--cyber-text-dim)]">
            No conversations yet.<br />
            Start a DM or create a channel.
          </div>
        )}
      </div>
    </div>
  )
}

function ChannelItem({ channel, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`chat-channel-item w-full text-left flex items-center gap-3 ${active ? 'active' : ''}`}
    >
      <span className="text-[var(--cyber-cyan)] text-sm font-medium">#</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-sm truncate ${active ? 'text-[var(--cyber-text)]' : 'text-[var(--cyber-text-dim)]'}`}>
            {channel.name}
          </span>
          {channel.last_message && (
            <span className="text-[10px] text-[var(--cyber-text-dim)] ml-2 flex-shrink-0">
              {timeAgo(channel.last_message.created_at)}
            </span>
          )}
        </div>
        {channel.last_message && (
          <p className="text-[11px] text-[var(--cyber-text-dim)] truncate mt-0.5">
            {channel.last_message.author_username}: {channel.last_message.content}
          </p>
        )}
      </div>
      {channel.unread_count > 0 && (
        <span className="chat-unread-badge">{channel.unread_count}</span>
      )}
    </button>
  )
}

function DMItem({ channel, active, currentUserId, onClick }) {
  const other = channel.other_user
  const displayName = other?.username || 'Unknown'

  return (
    <button
      onClick={onClick}
      className={`chat-channel-item w-full text-left flex items-center gap-3 ${active ? 'active' : ''}`}
    >
      <AvatarDisplay
        user={other ? { avatar_preset: other.avatar_preset, username: other.username } : null}
        size="w-8 h-8"
        textSize="text-xs"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-sm truncate ${active ? 'text-[var(--cyber-text)]' : 'text-[var(--cyber-text-dim)]'}`}>
            {displayName}
          </span>
          {channel.last_message && (
            <span className="text-[10px] text-[var(--cyber-text-dim)] ml-2 flex-shrink-0">
              {timeAgo(channel.last_message.created_at)}
            </span>
          )}
        </div>
        {channel.last_message && (
          <p className="text-[11px] text-[var(--cyber-text-dim)] truncate mt-0.5">
            {channel.last_message.content}
          </p>
        )}
      </div>
      {channel.unread_count > 0 && (
        <span className="chat-unread-badge">{channel.unread_count}</span>
      )}
    </button>
  )
}
