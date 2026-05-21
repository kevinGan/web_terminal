import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import { api } from '../api/http';

SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('zsh', bash);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('ts', typescript);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('html', markup);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('diff', diff);

interface Props {
  filePath: string;
  fileName: string;
  fileType: 'md' | 'txt' | 'html';
  cwd?: string;
}

export function FilePreviewPane({ filePath, fileName, fileType, cwd }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setContent(null);
    setBinary(false);
    api.files
      .read(filePath)
      .then((data) => {
        if (cancelled) return;
        if (data.binary) {
          setBinary(true);
          return;
        }
        setContent(data.content ?? '');
      })
      .catch((e) => {
        if (!cancelled) setErr(formatErr(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return (
    <div className="file-preview-pane">
      <header className="file-preview-pane-header">
        <span className="file-preview-pane-kind">{fileType.toUpperCase()}</span>
        <span className="file-preview-pane-path" title={filePath}>{filePath}</span>
        {cwd && <span className="file-preview-pane-cwd" title={cwd}>{shortCwd(cwd)}</span>}
      </header>
      <div className="file-preview-pane-body">
        {loading && <div className="file-preview-pane-empty">加载中…</div>}
        {err && <div className="file-preview-pane-empty file-preview-pane-error">{err}</div>}
        {!loading && !err && binary && (
          <div className="file-preview-pane-empty">二进制文件，无法预览</div>
        )}
        {!loading && !err && !binary && content != null && (
          <PreviewContent content={content} fileType={fileType} />
        )}
      </div>
    </div>
  );
}

function PreviewContent({ content, fileType }: { content: string; fileType: 'md' | 'txt' | 'html' }) {
  if (fileType === 'md') {
    return (
      <div className="file-preview-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const codeStr = String(children).replace(/\n$/, '');
              if (match) {
                return (
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match[1]}
                    PreTag="div"
                  >
                    {codeStr}
                  </SyntaxHighlighter>
                );
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  if (fileType === 'html') {
    const sanitized = content.replace(/<script[\s\S]*?<\/script>/gi, '');
    return (
      <iframe
        className="file-preview-html-iframe"
        srcDoc={sanitized}
        sandbox="allow-same-origin"
        title={fileType}
      />
    );
  }

  return <pre className="file-preview-txt">{content}</pre>;
}

function shortCwd(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 3) return p;
  return '…/' + parts.slice(-2).join('/');
}

function formatErr(e: unknown): string {
  if (e && typeof e === 'object' && 'status' in e) {
    const status = (e as { status: number }).status;
    const body = (e as { body?: unknown }).body;
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : '';
    return `请求失败 (HTTP ${status})${msg ? `: ${msg}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}
