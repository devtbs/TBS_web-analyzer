import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
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
    CodeBracketIcon,
    CheckIcon,
    CloudArrowUpIcon,
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
            type="button"
            onMouseDown={(e) => e.preventDefault()}
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

const parseDate = (date) => {
    if (!date) return null;
    if (date instanceof Date) return date;
    if (typeof date === 'string') {
        // If it's an ISO string without timezone, assume UTC
        const utcDate = date.endsWith('Z') || date.includes('+') ? date : `${date}Z`;
        return new Date(utcDate);
    }
    return new Date(date);
};

const extensions = [
    StarterKit,
    TextAlign.configure({
        types: ['heading', 'paragraph'],
    }),
];

export default function ArticleEditor({ initialMarkdown, title, onSave, onTitleChange, isSaving, onClose, documentId, lastSavedAt }) {
    const [wordCount, setWordCount] = useState(0);
    const [lastSaved, setLastSaved] = useState(parseDate(lastSavedAt));
    const [isDirty, setIsDirty] = useState(false);
    const [localTitle, setLocalTitle] = useState(title || 'Untitled document');
    const lastDocId = useRef(null);

    const editor = useEditor({
        extensions,
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
            setIsDirty(true);
        }
    });

    useEffect(() => {
        if (!isSaving && lastSaved === null && !isDirty) {
            // Initial load
        } else if (!isSaving && isSaving === false) {
            setLastSaved(new Date());
            setIsDirty(false);
        }
    }, [isSaving]);

    useEffect(() => {
        if (lastSavedAt && !isDirty) {
            setLastSaved(parseDate(lastSavedAt));
        }
    }, [lastSavedAt, isDirty]);

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
            setIsDirty(false);
            setLastSaved(parseDate(lastSavedAt));
            
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
    }, [editor, initialMarkdown, title, documentId, lastSavedAt]);

    const formatTime = (date) => {
        if (!date) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatStatus = () => {
        if (isSaving) return 'Saving...';
        if (isDirty) return 'Unsaved changes';
        if (!lastSaved) return 'Ready to edit';
        
        const now = new Date();
        const diffInSeconds = Math.floor((now - lastSaved) / 1000);
        
        if (diffInSeconds < 60) return 'Saved just now';
        
        return `Saved at ${formatTime(lastSaved)}`;
    };

    return (
        <div className="flex flex-col h-full bg-white relative">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 border-b border-slate-100 bg-white">
                {/* Left: back + title */}
                <div className="flex items-center gap-0 flex-1 min-w-0">
                    {onClose && (
                        <>
                            <button 
                                onClick={onClose}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0"
                                title="Back to Documents"
                            >
                                <ArrowLeftIcon className="w-4 h-4" />
                            </button>
                            <div className="w-px h-5 bg-slate-200 mx-2 flex-shrink-0" />
                        </>
                    )}
                    <input
                        type="text"
                        value={localTitle}
                        onChange={(e) => setLocalTitle(e.target.value)}
                        onFocus={(e) => {
                            if (e.target.value === 'Untitled document') e.target.select();
                        }}
                        onBlur={() => {
                            const trimmed = localTitle.trim() || 'Untitled document';
                            setLocalTitle(trimmed);
                            if (trimmed !== title && onTitleChange) onTitleChange(trimmed);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
                        }}
                        className="flex-1 min-w-0 text-[15px] font-normal text-slate-800 bg-transparent border-none outline-none focus:bg-slate-50 hover:bg-slate-50 rounded-lg px-2 py-1 -ml-1 transition-all placeholder:text-slate-300"
                        placeholder="Untitled document"
                    />
                </div>

                {/* Right: status + save */}
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    {/* Auto-save status badge */}
                    <span className={`hidden sm:flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all ${
                        isSaving 
                            ? 'bg-amber-50 text-amber-600' 
                            : isDirty 
                                ? 'bg-slate-100 text-slate-400'
                                : 'bg-emerald-50 text-emerald-600'
                    }`}>
                        {isSaving ? (
                            <>
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                Saving…
                            </>
                        ) : isDirty ? (
                            <>
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                                Unsaved
                            </>
                        ) : (
                            <>
                                <CheckIcon className="w-3 h-3" />
                                {formatStatus()}
                            </>
                        )}
                    </span>

                    {/* Save button */}
                    {onSave && (
                        <button 
                            onClick={() => onSave(editor.getHTML())}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-700 active:bg-slate-800 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-40 shadow-sm"
                        >
                            <CloudArrowUpIcon className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{isSaving ? 'Saving…' : 'Save'}</span>
                        </button>
                    )}
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
