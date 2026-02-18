import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { useRef, useEffect, useCallback } from 'react'
import TurndownService from 'turndown'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

// Convert simple markdown to HTML for initial editor load
function markdownToHtml(md) {
  if (!md) return ''
  let html = md
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  // Images (markdown syntax)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr />')
  // Paragraphs (lines not already wrapped)
  html = html.replace(/^(?!<[hulo\-bi]|<hr|<block|<img)(.+)$/gm, '<p>$1</p>')
  return html
}

function RichTextEditor({ content, onChange, placeholder, caveId }) {
  const fileInputRef = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
      }),
      Underline,
      Placeholder.configure({
        placeholder: placeholder || 'Write your description...',
      }),
    ],
    content: markdownToHtml(content),
    editorProps: {
      attributes: {
        class: 'prose-cave outline-none min-h-[200px] px-4 py-3',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      const md = turndown.turndown(html)
      onChange(md)
    },
  })

  // Sync content from outside
  useEffect(() => {
    if (editor && content !== undefined) {
      const currentMd = turndown.turndown(editor.getHTML())
      if (currentMd !== content) {
        editor.commands.setContent(markdownToHtml(content))
      }
    }
  }, [content, editor])

  const handleImageUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file || !editor || !caveId) return

    // Upload to server as a cave photo, then insert URL
    const formData = new FormData()
    formData.append('image', file)
    formData.append('caption', 'Inline description image')
    formData.append('tags', 'description')

    try {
      const res = await fetch(`/api/caves/${caveId}/photos/`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        editor.chain().focus().setImage({ src: data.image, alt: file.name }).run()
      }
    } catch (err) {
      // Fallback: embed as base64
      const reader = new FileReader()
      reader.onload = () => {
        editor.chain().focus().setImage({ src: reader.result, alt: file.name }).run()
      }
      reader.readAsDataURL(file)
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [editor, caveId])

  const addLink = useCallback(() => {
    if (!editor) return
    const url = window.prompt('Enter URL:')
    if (url) {
      editor.chain().focus().setLink({ href: url }).run()
    }
  }, [editor])

  if (!editor) return null

  return (
    <div className="rounded-2xl bg-[var(--cyber-bg)] border border-[var(--cyber-border)] overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 px-2 py-2 border-b border-[var(--cyber-border)] bg-[var(--cyber-surface)]">
        <ToolBtn
          active={editor.isActive('heading', { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          label="H1"
        />
        <ToolBtn
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          label="H2"
        />
        <ToolBtn
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          label="H3"
        />
        <Divider />
        <ToolBtn
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="B"
          className="font-bold"
        />
        <ToolBtn
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="I"
          className="italic"
        />
        <ToolBtn
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          label="U"
          className="underline"
        />
        <Divider />
        <ToolBtn
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="• List"
        />
        <ToolBtn
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="1. List"
        />
        <ToolBtn
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          label="&#x275D;"
        />
        <Divider />
        <ToolBtn
          active={editor.isActive('link')}
          onClick={addLink}
          label="Link"
        />
        <ToolBtn
          onClick={() => fileInputRef.current?.click()}
          label="Image"
        />
        <ToolBtn
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          label="&#x2014;"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />
      </div>

      {/* Editor content */}
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolBtn({ active, onClick, label, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-xs transition-all
        ${active
          ? 'bg-[var(--cyber-cyan)]/20 text-[var(--cyber-cyan)] border border-[var(--cyber-cyan)]/30'
          : 'text-[var(--cyber-text-dim)] hover:text-white hover:bg-[var(--cyber-surface-2)]'}
        ${className}`}
    >
      {label}
    </button>
  )
}

function Divider() {
  return <div className="w-px h-6 bg-[var(--cyber-border)] mx-0.5 self-center" />
}

export default RichTextEditor
