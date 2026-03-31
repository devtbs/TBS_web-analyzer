import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { marked } from 'marked';
import { 
    ArrowUturnLeftIcon, 
    ArrowUturnRightIcon,
    ArrowLeftIcon,
    Bars3CenterLeftIcon,
    Bars3Icon,
    Bars3BottomLeftIcon,
    Bars3BottomRightIcon,
    LinkIcon,
    CodeBracketIcon
} from '@heroicons/react/24/outline';

const MenuBar = ({ editor }) => {
    const [, setUpdateCount] = React.useState(0);

    React.useEffect(() => {
        if (!editor) return;
        
        const update = () => setUpdateCount(c => c + 1);
        
        editor.on('transaction', update);
        editor.on('selectionUpdate', update);
        
        return () => {
            editor.off('transaction', update);
            editor.off('selectionUpdate', update);
        };
    }, [editor]);

    if (!editor) {
        return null;
    }

    const ToolbarButton = ({ onClick, isActive, disabled, children }) => (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-50 transition-colors ${
                isActive ? 'bg-slate-200 text-slate-900 font-bold' : 'text-slate-600'
            }`}
        >
            {children}
        </button>
    );

    return (
        <div className="flex items-center gap-1 border-b border-slate-200 px-4 py-2 bg-white sticky top-0 z-10">
            <ToolbarButton
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().chain().focus().undo().run()}
            >
                <ArrowUturnLeftIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().chain().focus().redo().run()}
            >
                <ArrowUturnRightIcon className="w-4 h-4" />
            </ToolbarButton>
            
            <div className="w-px h-5 bg-slate-300 mx-2" />
            
            <select 
                className="text-sm border-none bg-transparent focus:ring-0 text-slate-800 font-bold py-1 px-2 cursor-pointer hover:bg-slate-100 rounded-md outline-none"
                onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'p') {
                        editor.chain().focus().setParagraph().run();
                    } else if (value === 'h1') {
                        editor.chain().focus().toggleHeading({ level: 1 }).run();
                    } else if (value === 'h2') {
                        editor.chain().focus().toggleHeading({ level: 2 }).run();
                    } else if (value === 'h3') {
                        editor.chain().focus().toggleHeading({ level: 3 }).run();
                    }
                }}
                value={
                    editor.isActive('heading', { level: 1 }) ? 'h1' : 
                    editor.isActive('heading', { level: 2 }) ? 'h2' : 
                    editor.isActive('heading', { level: 3 }) ? 'h3' : 
                    'p'
                }
            >
                <option value="p">Normal Text</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
            </select>

            <div className="w-px h-5 bg-slate-300 mx-2" />

            <ToolbarButton
                onClick={() => editor.chain().focus().toggleBold().run()}
                isActive={editor.isActive('bold')}
            >
                <span className="font-bold font-serif w-4 h-4 flex items-center justify-center">B</span>
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                isActive={editor.isActive('italic')}
            >
                <span className="italic font-serif w-4 h-4 flex items-center justify-center">I</span>
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                isActive={editor.isActive('underline')}
            >
                <span className="underline font-serif w-4 h-4 flex items-center justify-center">U</span>
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                isActive={editor.isActive('strike')}
            >
                <span className="line-through font-serif w-4 h-4 flex items-center justify-center">S</span>
            </ToolbarButton>

            <div className="w-px h-5 bg-slate-300 mx-2" />

            <ToolbarButton
                onClick={() => editor.chain().focus().toggleCode().run()}
                isActive={editor.isActive('code')}
            >
                <CodeBracketIcon className="w-4 h-4" />
            </ToolbarButton>
            
            <div className="w-px h-5 bg-slate-300 mx-2" />

            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
                isActive={editor.isActive({ textAlign: 'left' })}
            >
                <Bars3BottomLeftIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
                isActive={editor.isActive({ textAlign: 'center' })}
            >
                <Bars3CenterLeftIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
                isActive={editor.isActive({ textAlign: 'right' })}
            >
                <Bars3BottomRightIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                isActive={editor.isActive({ textAlign: 'justify' })}
            >
                <Bars3Icon className="w-4 h-4" />
            </ToolbarButton>
            
            <div className="w-px h-5 bg-slate-300 mx-2" />
        </div>
    );
};

export default function ArticleEditor({ initialMarkdown, title, onSave, isSaving, onClose, documentId }) {
    const [wordCount, setWordCount] = useState(0);
    const lastDocId = useRef(null);

    const editor = useEditor({
        extensions: [
            StarterKit,
            Underline,
            TextAlign.configure({
                types: ['heading', 'paragraph'],
            }),
        ],
        content: '',
        editorProps: {
            attributes: {
                class: 'prose prose-slate prose-lg max-w-none focus:outline-none min-h-[500px] leading-relaxed',
            },
        },
        onUpdate: ({ editor }) => {
            const text = editor.getText();
            const words = text.trim().split(/\s+/).filter(word => word.length > 0).length;
            setWordCount(words);
        }
    });

    useEffect(() => {
        if (!editor || editor.isDestroyed) return;
        
        // Only set content if we switch to a new document or if the editor is empty
        if (lastDocId.current !== documentId || editor.isEmpty) {
            const contentMarkdown = initialMarkdown || '';
            if (contentMarkdown.trim()) {
                const isHTML = contentMarkdown.trim().startsWith('<');
                const html = isHTML ? contentMarkdown : marked(contentMarkdown);
                editor.commands.setContent(html, false); // false = don't emit update
            } else {
                editor.commands.setContent('', false);
            }
            lastDocId.current = documentId;
            
            // Focus the editor automatically only if it's a new (empty) document
            if (!contentMarkdown.trim()) {
                editor.commands.focus('end');
            }
            
            // Re-calc word count after content set
            setTimeout(() => {
                const text = editor.getText();
                const words = text.trim().split(/\s+/).filter(word => word.length > 0).length;
                setWordCount(words);
            }, 50);
        }
    }, [editor, initialMarkdown, title, documentId]);

    return (
        <div className="flex flex-col h-full bg-white relative">
            {/* Top Toolbar matching screenshot Style */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200">
                <div className="flex items-center gap-4">
                    {onClose && (
                        <button 
                            onClick={onClose}
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors mr-2"
                        >
                            <ArrowLeftIcon className="w-5 h-5" />
                        </button>
                    )}
                    <h2 className="text-sm font-bold text-slate-800 truncate max-w-sm" title={title}>
                        {title.length > 30 ? title.substring(0, 30) + '...' : title}
                    </h2>
                </div>
                <div className="flex items-center gap-4">
                    {onSave && (
                        <button 
                            onClick={() => onSave(editor.getHTML())}
                            disabled={isSaving}
                            className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded font-medium disabled:opacity-50 transition-colors shadow-sm"
                        >
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    )}
                    <span className="text-xs text-slate-400 font-medium">Saved just now</span>
                </div>
            </div>

            <MenuBar editor={editor} />

            {/* Main Editor Area */}
            <div className="flex-1 overflow-y-auto relative bg-white flex justify-center py-12 px-8">
                <div className="w-full max-w-[800px] relative">
                    <EditorContent editor={editor} />
                </div>
            </div>
            
            {/* Word count watermark at the bottom right */}
            <div className="sticky bottom-6 flex justify-end px-8 pointer-events-none">
                <span className="text-sm font-medium text-slate-400/80 bg-white/80 px-2 rounded hidden md:block">
                    {wordCount} words
                </span>
            </div>
        </div>
    );
}
