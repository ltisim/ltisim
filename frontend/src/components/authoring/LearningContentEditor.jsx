import React, { useEffect } from 'react'
import { useEditor, EditorContent, Node, mergeAttributes } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Youtube from '@tiptap/extension-youtube'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading2, Heading3, List, ListOrdered, Quote, Code,
  Link as LinkIcon, Image as ImageIcon, Youtube as YoutubeIcon,
  Code2, Undo, Redo,
} from 'lucide-react'

// Custom Iframe node — lets instructors embed CodePen, H5P, GeoGebra, etc.
const Iframe = Node.create({
  name: 'iframe',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      width: { default: '100%' },
      height: { default: '480' },
      frameborder: { default: '0' },
      allowfullscreen: { default: true },
    }
  },
  parseHTML() {
    return [{ tag: 'iframe' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['iframe', mergeAttributes(HTMLAttributes)]
  },
})

function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-primary-100 text-primary-700' : 'text-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

function LearningContentEditor({ content, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Image,
      Youtube.configure({
        controls: true,
        nocookie: true,
        width: 640,
        height: 360,
      }),
      Iframe,
    ],
    content: content?.html || '',
    onUpdate: ({ editor }) => {
      onChange({ ...(content || {}), html: editor.getHTML() })
    },
  })

  // If parent re-loads content (e.g. after fetch), sync into the editor.
  useEffect(() => {
    if (!editor) return
    const incoming = content?.html || ''
    if (incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, content?.html])

  if (!editor) return null

  const promptForLink = () => {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('Link URL', previousUrl || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const promptForImage = () => {
    const url = window.prompt('Image URL', 'https://')
    if (url) editor.chain().focus().setImage({ src: url }).run()
  }

  const promptForYoutube = () => {
    const url = window.prompt('YouTube or Vimeo URL', 'https://www.youtube.com/watch?v=')
    if (url) editor.commands.setYoutubeVideo({ src: url })
  }

  const promptForIframe = () => {
    const url = window.prompt(
      'Embed URL (iframe). Note: only allowlisted hostnames will render after save (default: YouTube, Vimeo). Ask your admin to add hostnames if needed.',
      'https://'
    )
    if (!url) return
    editor.chain().focus().insertContent({
      type: 'iframe',
      attrs: { src: url, width: '100%', height: '480' },
    }).run()
  }

  return (
    <div className="border-2 border-gray-200 rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-300 mx-1" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        >
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          title="Heading 3"
        >
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-300 mx-1" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          title="Blockquote"
        >
          <Quote className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive('codeBlock')}
          title="Code block"
        >
          <Code2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          title="Inline code"
        >
          <Code className="w-4 h-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-300 mx-1" />
        <ToolbarButton onClick={promptForLink} active={editor.isActive('link')} title="Link">
          <LinkIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={promptForImage} title="Image (URL)">
          <ImageIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={promptForYoutube} title="YouTube / Vimeo video">
          <YoutubeIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={promptForIframe} title="Embed (iframe URL)">
          <span className="text-xs font-bold">⧉</span>
        </ToolbarButton>
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo"
          >
            <Undo className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo"
          >
            <Redo className="w-4 h-4" />
          </ToolbarButton>
        </div>
      </div>
      <div className="p-4 bg-white min-h-[400px] max-h-[640px] overflow-y-auto">
        <EditorContent editor={editor} className="prose prose-sm max-w-none focus:outline-none [&_.ProseMirror]:min-h-[360px] [&_.ProseMirror]:outline-none" />
      </div>
    </div>
  )
}

export default LearningContentEditor
